import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Agent, AgentConflictError, AgentRow, AgentStatus, RegisterAgentInput } from "../types/index.js";
import { getDatabase, now } from "./database.js";

function getActiveWindowMs(): number {
  const env = process.env["TELEPHONY_AGENT_TIMEOUT_MS"];
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30 * 60 * 1000;
}

export function autoReleaseStaleAgents(db?: Database): number {
  if (process.env["TELEPHONY_AGENT_AUTO_RELEASE"] !== "true") return 0;
  const d = db || getDatabase();
  const cutoff = new Date(Date.now() - getActiveWindowMs()).toISOString();
  const result = d.run(
    "UPDATE agents SET session_id = NULL WHERE status = 'active' AND session_id IS NOT NULL AND last_seen_at < ?",
    [cutoff],
  );
  return result.changes;
}

function shortUuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function rowToAgent(row: AgentRow): Agent {
  return {
    ...row,
    permissions: JSON.parse(row.permissions || '["*"]') as string[],
    capabilities: JSON.parse(row.capabilities || "[]") as string[],
    status: (row.status || "active") as AgentStatus,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function registerAgent(input: RegisterAgentInput, db?: Database): Agent | AgentConflictError {
  const d = db || getDatabase();
  const normalizedName = input.name.trim().toLowerCase();

  const existing = getAgentByName(normalizedName, d);
  if (existing) {
    const lastSeenMs = new Date(existing.last_seen_at).getTime();
    const activeWindowMs = getActiveWindowMs();
    const isStale = Date.now() - lastSeenMs > activeWindowMs;

    if (input.session_id && existing.session_id === input.session_id) {
      d.run("UPDATE agents SET last_seen_at = ?, updated_at = ? WHERE id = ?", [now(), now(), existing.id]);
      return getAgent(existing.id, d)!;
    }

    if (!isStale && !input.force && existing.session_id) {
      return {
        error: "conflict",
        message: `Agent name "${normalizedName}" is currently held by an active session`,
        existing_agent: existing,
      };
    }

    // Takeover: stale or force
    const timestamp = now();
    d.run(
      `UPDATE agents SET session_id = ?, description = COALESCE(?, description),
       project_id = COALESCE(?, project_id),
       capabilities = ?, permissions = ?, status = 'active',
       metadata = ?, last_seen_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.session_id || null,
        input.description || null,
        input.project_id || null,
        JSON.stringify(input.capabilities || existing.capabilities),
        JSON.stringify(input.permissions || existing.permissions),
        JSON.stringify({}),
        timestamp,
        timestamp,
        existing.id,
      ],
    );
    return getAgent(existing.id, d)!;
  }

  // New agent
  const id = shortUuid();
  const timestamp = now();
  d.run(
    `INSERT INTO agents (id, name, description, session_id, project_id, capabilities, permissions, status, metadata, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?, ?)`,
    [
      id,
      normalizedName,
      input.description || null,
      input.session_id || null,
      input.project_id || null,
      JSON.stringify(input.capabilities || []),
      JSON.stringify(input.permissions || ["*"]),
      timestamp,
      timestamp,
      timestamp,
    ],
  );

  return getAgent(id, d)!;
}

export function getAgent(id: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function getAgentByName(name: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM agents WHERE LOWER(name) = ?").get(name.toLowerCase()) as AgentRow | null;
  return row ? rowToAgent(row) : null;
}

export function listAgents(projectId?: string, db?: Database): Agent[] {
  const d = db || getDatabase();
  if (projectId) {
    return (d.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY name").all(projectId) as AgentRow[]).map(rowToAgent);
  }
  return (d.prepare("SELECT * FROM agents ORDER BY name").all() as AgentRow[]).map(rowToAgent);
}

export function heartbeat(agentId: string, db?: Database): Agent | null {
  const d = db || getDatabase();
  const timestamp = now();
  d.run("UPDATE agents SET last_seen_at = ?, updated_at = ? WHERE id = ?", [timestamp, timestamp, agentId]);
  return getAgent(agentId, d);
}

export function releaseAgent(agentId: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("UPDATE agents SET session_id = NULL, status = 'inactive', updated_at = ? WHERE id = ?", [now(), agentId]).changes > 0;
}

export function deleteAgent(agentId: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM agents WHERE id = ?", [agentId]).changes > 0;
}
