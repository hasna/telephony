/**
 * @hasna/telephony — HTTP serve surface (telephony-serve).
 *
 * A real HTTP API wrapping the telephony core data model. PURE REMOTE per
 * Amendment A1: the service reads and writes the shared cloud Postgres directly
 * (no local cache, no sync engine in the service). Requests are authenticated
 * with @hasna/contracts API-key middleware.
 *
 * Public probes:
 *   GET  /health          liveness — { status, version, mode }
 *   GET  /ready           readiness — pings the DB
 *   GET  /version         { status, version, mode }
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)
 *
 * Versioned API (all require an API key; scopes telephony:read / telephony:write):
 *   /v1/contacts          CRUD (list/create/get/patch/delete)
 *   /v1/projects          list/create/get/delete
 *   /v1/agents            list/register/get
 *   /v1/numbers           list/get
 *   /v1/numbers/available Twilio proxy: search available numbers (server creds)
 *   /v1/numbers/twilio    Twilio proxy: list account numbers (server creds)
 *   /v1/messages          list/get
 *   /v1/calls             list/get
 *   /v1/voicemails        list/get
 *   /v1/schedules         list/create/get
 *   /v1/webhooks          list/create/get
 */
import { readFileSync } from "node:fs";
import {
  verifyApiKey,
  ApiKeyStore,
  type ApiKeyVerifier,
  type ApiKeyPrincipal,
} from "@hasna/contracts/auth";
import { createTelephonyCloudClient } from "../db/remote-storage.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/index.js";
import { getTwilioClient, hasTwilioConfig } from "../lib/twilio.js";
import { fetchVoicesFromProvider, hasElevenLabsConfig } from "../lib/tts.js";

export const TELEPHONY_SERVE_APP = "telephony";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Never logs the URL. Returns the (possibly) updated value.
 */
export function normalizeCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = "HASNA_TELEPHONY_DATABASE_URL";
  const url = env[key] ?? env.TELEPHONY_DATABASE_URL;
  if (!url) return url;
  const lower = url.toLowerCase();
  const needsCompat =
    (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) &&
    !lower.includes("uselibpqcompat");
  if (!needsCompat) return url;
  const updated = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}

function resolveVersion(): string {
  if (process.env.HASNA_TELEPHONY_VERSION) return process.env.HASNA_TELEPHONY_VERSION;
  try {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}

function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_TELEPHONY_API_SIGNING_KEY ?? env.API_KEY_SIGNING_SECRET ?? env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      "telephony-serve requires an API signing secret: set HASNA_TELEPHONY_API_SIGNING_KEY " +
        "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Row mappers (JSON columns are TEXT; timestamps come back as Date via pg)
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function iso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function uuid(): string {
  return crypto.randomUUID();
}

function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }
  return v;
}

function clampLimit(raw: string | null, def = 50, max = 200): number {
  const n = raw == null ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/**
 * The window after which an agent's held session is considered stale — matches
 * the local db/agents.ts default (30 min, overridable via
 * TELEPHONY_AGENT_TIMEOUT_MS) so registration takeover behaves identically in
 * local and cloud mode.
 */
function agentActiveWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TELEPHONY_AGENT_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Repositories — cloud Postgres (PURE REMOTE / A1)
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: unknown;
}

function mapContact(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    email: (r.email as string | null) ?? null,
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    tags: parseJson<string[]>(r.tags, []),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapProject(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    path: String(r.path ?? ""),
    description: (r.description as string | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapAgent(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: (r.description as string | null) ?? null,
    session_id: (r.session_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    capabilities: parseJson<string[]>(r.capabilities, []),
    permissions: parseJson<string[]>(r.permissions, ["*"]),
    status: String(r.status ?? "active"),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    last_seen_at: iso(r.last_seen_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapNumber(r: Row) {
  return {
    id: String(r.id),
    number: String(r.number ?? ""),
    country: String(r.country ?? "US"),
    capabilities: parseJson<string[]>(r.capabilities, []),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    friendly_name: (r.friendly_name as string | null) ?? null,
    status: String(r.status ?? "active"),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapMessage(r: Row) {
  return {
    id: String(r.id),
    type: String(r.type ?? ""),
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    body: (r.body as string | null) ?? null,
    media_url: (r.media_url as string | null) ?? null,
    status: String(r.status ?? ""),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    error_message: (r.error_message as string | null) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapCall(r: Row) {
  return {
    id: String(r.id),
    direction: String(r.direction ?? ""),
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    status: String(r.status ?? ""),
    duration: (r.duration as number | null) ?? null,
    recording_url: (r.recording_url as string | null) ?? null,
    transcription: (r.transcription as string | null) ?? null,
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    started_at: iso(r.started_at),
    ended_at: isoOrNull(r.ended_at),
    created_at: iso(r.created_at),
  };
}

function mapVoicemail(r: Row) {
  return {
    id: String(r.id),
    call_id: (r.call_id as string | null) ?? null,
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    recording_url: (r.recording_url as string | null) ?? null,
    local_path: (r.local_path as string | null) ?? null,
    transcription: (r.transcription as string | null) ?? null,
    duration: (r.duration as number | null) ?? null,
    listened: Boolean(r.listened),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    created_at: iso(r.created_at),
  };
}

function mapSchedule(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    cron_expression: String(r.cron_expression ?? ""),
    action: String(r.action ?? "custom"),
    command: String(r.command ?? ""),
    parameters: parseJson<Record<string, unknown>>(r.parameters, {}),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    enabled: Boolean(r.enabled),
    last_run: isoOrNull(r.last_run),
    next_run: isoOrNull(r.next_run),
    run_count: Number(r.run_count ?? 0),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapWebhook(r: Row) {
  return {
    id: String(r.id),
    url: String(r.url ?? ""),
    events: parseJson<string[]>(r.events, []),
    secret_configured: Boolean(r.secret),
    active: Boolean(r.active),
    created_at: iso(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export interface ServeDeps {
  client: PoolQueryClient;
  verifier: ApiKeyVerifier;
  store: ApiKeyStore;
  version: string;
}

export function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const db: TypedQueryClient = deps.client;
  const mode = "cloud";

  const authOrThrow = async (req: Request, requiredScopes: string[]): Promise<ApiKeyPrincipal> => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    void deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };

  const readBody = async (req: Request): Promise<Record<string, unknown>> => {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid JSON request body");
    });
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "JSON request body must be an object");
    }
    return body as Record<string, unknown>;
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, x-api-key",
        },
      });
    }

    try {
      // ---- Public probes ----
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/ready" && method === "GET") {
        try {
          await db.query("SELECT 1");
          return json({ status: "ready", version: deps.version, mode });
        } catch {
          return json({ status: "unavailable", version: deps.version, mode }, 503);
        }
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(telephonyOpenApi(deps.version));
      }

      // ---- /v1/contacts (full CRUD) ----
      if (path === "/v1/contacts") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const limit = clampLimit(url.searchParams.get("limit"));
          const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
          const search = url.searchParams.get("search");
          const params: unknown[] = [];
          const conds: string[] = [];
          // Parity with LocalStore.listContacts: agent_id/project_id are exact
          // scoping filters. Dropping them in cloud mode over-exposed every
          // agent's contacts across the shared fleet.
          for (const col of ["agent_id", "project_id"]) {
            const val = url.searchParams.get(col);
            if (val != null && val !== "") {
              params.push(val);
              conds.push(`${col} = $${params.length}`);
            }
          }
          if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conds.push(`(name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
          }
          const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
          const total = await db.get<{ count: string }>(
            `SELECT count(*)::text AS count FROM contacts ${where}`,
            params,
          );
          const rows = await db.many<Row>(
            `SELECT * FROM contacts ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params,
          );
          return json({ items: rows.map(mapContact), total: Number(total?.count ?? 0) });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const phone = requireString(body, "phone");
          const id = uuid();
          const row = await db.get<Row>(
            `INSERT INTO contacts (id, name, phone, email, agent_id, project_id, notes, tags, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              name,
              phone,
              (body.email as string) ?? null,
              (body.agent_id as string) ?? null,
              (body.project_id as string) ?? null,
              (body.notes as string) ?? null,
              JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
              JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
            ],
          );
          return json(mapContact(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      const contactMatch = path.match(/^\/v1\/contacts\/([^/]+)$/);
      if (contactMatch) {
        const id = decodeURIComponent(contactMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM contacts WHERE id = $1`, [id]);
          return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const sets: string[] = [];
          const params: unknown[] = [];
          const push = (col: string, val: unknown) => {
            params.push(val);
            sets.push(`${col} = $${params.length}`);
          };
          if (typeof body.name === "string") push("name", body.name);
          if (typeof body.phone === "string") push("phone", body.phone);
          if (body.email !== undefined) push("email", (body.email as string) ?? null);
          if (body.notes !== undefined) push("notes", (body.notes as string) ?? null);
          if (body.tags !== undefined) push("tags", JSON.stringify(Array.isArray(body.tags) ? body.tags : []));
          if (body.metadata !== undefined)
            push("metadata", JSON.stringify((body.metadata as Record<string, unknown>) ?? {}));
          if (sets.length === 0) {
            const row = await db.get<Row>(`SELECT * FROM contacts WHERE id = $1`, [id]);
            return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
          }
          sets.push(`updated_at = NOW()`);
          params.push(id);
          const row = await db.get<Row>(
            `UPDATE contacts SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
            params,
          );
          return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM contacts WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- /v1/projects ----
      if (path === "/v1/projects") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(`SELECT * FROM projects ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapProject), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const p = requireString(body, "path");
          const row = await db.get<Row>(
            `INSERT INTO projects (id, name, path, description) VALUES ($1,$2,$3,$4)
             ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() RETURNING *`,
            [uuid(), name, p, (body.description as string) ?? null],
          );
          return json(mapProject(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const projectMatch = path.match(/^\/v1\/projects\/([^/]+)$/);
      if (projectMatch) {
        const id = decodeURIComponent(projectMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM projects WHERE id = $1`, [id]);
          return row ? json(mapProject(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM projects WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- /v1/agents ----
      if (path === "/v1/agents") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          // Parity with LocalStore.listAgents: agent_id/project_id are exact
          // scoping filters served DB-side (they were silently dropped before,
          // so `--project X` returned every agent in cloud mode).
          const where: string[] = [`status != 'archived'`];
          const params: unknown[] = [];
          for (const col of ["agent_id", "project_id"]) {
            const val = url.searchParams.get(col);
            if (val != null && val !== "") {
              params.push(val);
              // agent_id maps to the primary key `id`.
              where.push(`${col === "agent_id" ? "id" : col} = $${params.length}`);
            }
          }
          const rows = await db.many<Row>(
            `SELECT * FROM agents WHERE ${where.join(" AND ")} ORDER BY last_seen_at DESC LIMIT 200`,
            params,
          );
          return json({ items: rows.map(mapAgent), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          // Parity with LocalStore.registerAgent (db/agents.ts): normalize the
          // name (trim + lowercase), then enforce active-session conflict /
          // force-takeover semantics. Previously the cloud route did a blind
          // INSERT — no normalization, no conflict detection — so the same name
          // could be registered by two live sessions (split-brain identity).
          const name = requireString(body, "name").trim().toLowerCase();
          const sessionId = (body.session_id as string) ?? null;
          const force = body.force === true;
          const existing = await db.get<Row>(`SELECT * FROM agents WHERE LOWER(name) = $1`, [name]);
          if (existing) {
            const existingSession = (existing.session_id as string | null) ?? null;
            // Same session re-registering: refresh liveness, return existing.
            if (sessionId && existingSession === sessionId) {
              const row = await db.get<Row>(
                `UPDATE agents SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
                [existing.id],
              );
              return json(mapAgent(row!), 200);
            }
            const lastSeenMs = Date.parse(iso(existing.last_seen_at));
            const isStale = !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > agentActiveWindowMs();
            // Held by a live session and not forced: conflict (never overwrite).
            if (!isStale && !force && existingSession) {
              return json(
                {
                  error: "conflict",
                  message: `Agent name "${name}" is currently held by an active session`,
                  existing_agent: mapAgent(existing),
                },
                409,
              );
            }
            // Takeover (stale session or --force).
            const row = await db.get<Row>(
              `UPDATE agents SET session_id = $1, description = COALESCE($2, description),
                 project_id = COALESCE($3, project_id), capabilities = $4, permissions = $5,
                 status = 'active', metadata = '{}', last_seen_at = NOW(), updated_at = NOW()
               WHERE id = $6 RETURNING *`,
              [
                sessionId,
                (body.description as string) ?? null,
                (body.project_id as string) ?? null,
                JSON.stringify(
                  Array.isArray(body.capabilities)
                    ? body.capabilities
                    : parseJson<string[]>(existing.capabilities, []),
                ),
                JSON.stringify(
                  Array.isArray(body.permissions)
                    ? body.permissions
                    : parseJson<string[]>(existing.permissions, ["*"]),
                ),
                existing.id,
              ],
            );
            return json(mapAgent(row!), 200);
          }
          // Brand-new agent — persist the normalized name.
          const row = await db.get<Row>(
            `INSERT INTO agents (id, name, description, session_id, project_id, capabilities, permissions, status, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'active','{}') RETURNING *`,
            [
              uuid(),
              name,
              (body.description as string) ?? null,
              sessionId,
              (body.project_id as string) ?? null,
              JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : []),
              JSON.stringify(Array.isArray(body.permissions) ? body.permissions : ["*"]),
            ],
          );
          return json(mapAgent(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- read-only collections ----
      // `filters` are exact-match columns (col = $n). `search` (when present)
      // maps the `search` query param to a case-insensitive substring (ILIKE)
      // match over the listed columns, ordered newest-first. NOTE: this differs
      // from LocalStore.searchMessages, which uses SQLite FTS5 (tokenized MATCH,
      // relevance-ranked); the ILIKE path is a recency-ordered substring match,
      // not a token-relevance search. `phone` maps the `number` query param to
      // (from_number = $n OR to_number = $n) — parity with
      // LocalStore.getConversation. Both must be served DB-side so cloud never
      // silently searches only the most-recent page at fleet scale.
      const listOnly: Record<
        string,
        { table: string; order: string; map: (r: Row) => unknown; filters: string[]; bools?: string[]; search?: string[]; phone?: boolean }
      > = {
        "/v1/numbers": { table: "phone_numbers", order: "created_at DESC", map: mapNumber, filters: ["agent_id", "project_id", "status", "number"] },
        "/v1/messages": { table: "messages", order: "created_at DESC", map: mapMessage, filters: ["agent_id", "project_id", "type"], search: ["body"], phone: true },
        "/v1/calls": { table: "calls", order: "started_at DESC", map: mapCall, filters: ["agent_id", "project_id"] },
        "/v1/voicemails": { table: "voicemails", order: "created_at DESC", map: mapVoicemail, filters: ["agent_id", "project_id", "listened"], bools: ["listened"] },
      };
      if (listOnly[path] && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = listOnly[path]!;
        const limit = clampLimit(url.searchParams.get("limit"));
        const where: string[] = [];
        const params: unknown[] = [];
        for (const col of spec.filters) {
          const val = url.searchParams.get(col);
          if (val != null && val !== "") {
            // Boolean filter columns (e.g. voicemails.listened) arrive as the
            // strings "true"/"false"; bind a real boolean so Postgres compares
            // boolean = boolean rather than boolean = text.
            params.push(spec.bools?.includes(col) ? val === "true" || val === "1" : val);
            where.push(`${col} = $${params.length}`);
          }
        }
        if (spec.search) {
          const term = url.searchParams.get("search");
          if (term != null && term !== "") {
            params.push(`%${term}%`);
            const idx = params.length;
            where.push(`(${spec.search.map((c) => `${c} ILIKE $${idx}`).join(" OR ")})`);
          }
        }
        if (spec.phone) {
          const num = url.searchParams.get("number");
          if (num != null && num !== "") {
            params.push(num);
            const idx = params.length;
            where.push(`(from_number = $${idx} OR to_number = $${idx})`);
          }
        }
        const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const rows = await db.many<Row>(
          `SELECT * FROM ${spec.table} ${clause} ORDER BY ${spec.order} LIMIT ${limit}`,
          params,
        );
        return json({ items: rows.map(spec.map), total: rows.length });
      }
      // ---- Twilio provider passthrough (server-side proxy) ----
      // Live reads against the Twilio API using the server's Twilio credential
      // (from Secrets Manager / env — NEVER distributed to clients). ApiStore
      // routes CLI/MCP/SDK `searchAvailableNumbers` / `listTwilioNumbers` here so
      // the client never holds real Twilio creds. Read-only, additive, reversible.
      // Placed BEFORE the `/v1/numbers/:id` single-GET matcher so the literal
      // sub-paths aren't captured as an id lookup.
      if (path === "/v1/numbers/available" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasTwilioConfig()) {
          return json({ error: "twilio_not_configured", message: "Server has no Twilio credential configured." }, 501);
        }
        const country = url.searchParams.get("country") || "US";
        const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
        const params: Record<string, unknown> = { limit };
        const areaCode = url.searchParams.get("area_code");
        const contains = url.searchParams.get("contains");
        const smsEnabled = url.searchParams.get("sms_enabled");
        const voiceEnabled = url.searchParams.get("voice_enabled");
        if (areaCode) params.areaCode = parseInt(areaCode, 10);
        if (contains) params.contains = contains;
        if (smsEnabled != null) params.smsEnabled = smsEnabled === "true" || smsEnabled === "1";
        if (voiceEnabled != null) params.voiceEnabled = voiceEnabled === "true" || voiceEnabled === "1";
        try {
          const numbers = await getTwilioClient().availablePhoneNumbers(country).local.list(params);
          const items = numbers.map((n) => ({
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName,
            locality: n.locality,
            region: n.region,
            capabilities: { voice: n.capabilities.voice, sms: n.capabilities.sms, mms: n.capabilities.mms },
          }));
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "twilio_error", message: err instanceof Error ? err.message : "twilio request failed" }, 502);
        }
      }
      if (path === "/v1/numbers/twilio" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasTwilioConfig()) {
          return json({ error: "twilio_not_configured", message: "Server has no Twilio credential configured." }, 501);
        }
        try {
          const numbers = await getTwilioClient().incomingPhoneNumbers.list({ limit: 100 });
          const items = numbers.map((n) => ({ sid: n.sid, phoneNumber: n.phoneNumber, friendlyName: n.friendlyName }));
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "twilio_error", message: err instanceof Error ? err.message : "twilio request failed" }, 502);
        }
      }
      // ---- ElevenLabs provider passthrough (server-side proxy) ----
      // Live read of TTS voices using the server's ElevenLabs credential (from
      // Secrets Manager / env — NEVER distributed to clients). ApiStore routes
      // CLI/MCP/SDK `listVoices` here so the client never holds a real
      // ElevenLabs key. Read-only, additive, reversible.
      if (path === "/v1/voices" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasElevenLabsConfig()) {
          return json({ error: "elevenlabs_not_configured", message: "Server has no ElevenLabs credential configured." }, 501);
        }
        try {
          const items = await fetchVoicesFromProvider();
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "elevenlabs_error", message: err instanceof Error ? err.message : "elevenlabs request failed" }, 502);
        }
      }

      const singleGet: Record<string, { table: string; map: (r: Row) => unknown }> = {
        numbers: { table: "phone_numbers", map: mapNumber },
        messages: { table: "messages", map: mapMessage },
        calls: { table: "calls", map: mapCall },
        voicemails: { table: "voicemails", map: mapVoicemail },
        agents: { table: "agents", map: mapAgent },
      };
      const singleMatch = path.match(/^\/v1\/(numbers|messages|calls|voicemails|agents)\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = singleGet[singleMatch[1]!]!;
        const row = await db.get<Row>(`SELECT * FROM ${spec.table} WHERE id = $1`, [
          decodeURIComponent(singleMatch[2]!),
        ]);
        return row ? json(spec.map(row)) : json({ error: "not_found" }, 404);
      }

      // ---- writes for numbers/messages/calls/voicemails ----
      // ApiStore (client-flip cloud transport) routes provider-side records
      // (createMessage/updateMessageStatus, createCall/updateCallStatus,
      // createVoicemail/markVoicemailListened, createPhoneNumber/assign/release)
      // through these. Requires an ECS redeploy after ship.
      if (path === "/v1/messages" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO messages (id, type, from_number, to_number, body, media_url, status, agent_id, project_id, twilio_sid, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            uuid(),
            requireString(body, "type"),
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            (body.body as string) ?? null,
            (body.media_url as string) ?? null,
            typeof body.status === "string" ? body.status : "queued",
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapMessage(row!), 201);
      }
      if (path === "/v1/calls" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO calls (id, direction, from_number, to_number, status, agent_id, project_id, twilio_sid, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            uuid(),
            requireString(body, "direction"),
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            typeof body.status === "string" ? body.status : "initiated",
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapCall(row!), 201);
      }
      if (path === "/v1/voicemails" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO voicemails (id, call_id, from_number, to_number, recording_url, local_path, transcription, duration, agent_id, project_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            uuid(),
            (body.call_id as string) ?? null,
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            (body.recording_url as string) ?? null,
            (body.local_path as string) ?? null,
            (body.transcription as string) ?? null,
            typeof body.duration === "number" ? body.duration : null,
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
          ],
        );
        return json(mapVoicemail(row!), 201);
      }
      if (path === "/v1/numbers" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO phone_numbers (id, number, country, capabilities, agent_id, project_id, twilio_sid, friendly_name, status, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            uuid(),
            requireString(body, "number"),
            typeof body.country === "string" ? body.country : "US",
            JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : ["sms", "voice"]),
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            (body.friendly_name as string) ?? null,
            typeof body.status === "string" ? body.status : "active",
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapNumber(row!), 201);
      }
      const writeSingle = path.match(/^\/v1\/(numbers|messages|calls|voicemails)\/([^/]+)$/);
      if (writeSingle && method === "PATCH") {
        await authOrThrow(req, ["telephony:write"]);
        const resource = writeSingle[1]!;
        const id = decodeURIComponent(writeSingle[2]!);
        const body = await readBody(req);
        const table = singleGet[resource]!.table;
        const mapper = singleGet[resource]!.map;
        const allowed: Record<string, string[]> = {
          messages: ["status", "error_message", "twilio_sid"],
          calls: ["status", "duration", "recording_url", "transcription", "ended_at", "twilio_sid"],
          voicemails: ["listened", "transcription", "local_path"],
          numbers: ["agent_id", "project_id", "status", "friendly_name"],
        };
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const col of allowed[resource]!) {
          if (body[col] !== undefined) {
            params.push(body[col]);
            sets.push(`${col} = $${params.length}`);
          }
        }
        if (sets.length === 0) {
          const row = await db.get<Row>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
          return row ? json(mapper(row)) : json({ error: "not_found" }, 404);
        }
        // calls/voicemails have no updated_at column; only bump it where present.
        if (resource === "messages" || resource === "numbers") sets.push(`updated_at = NOW()`);
        params.push(id);
        const row = await db.get<Row>(
          `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        return row ? json(mapper(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/agents/:id (heartbeat / release / focus) ----
      const agentPatch = path.match(/^\/v1\/agents\/([^/]+)$/);
      if (agentPatch && method === "PATCH") {
        await authOrThrow(req, ["telephony:write"]);
        const id = decodeURIComponent(agentPatch[1]!);
        const body = await readBody(req);
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const col of ["status", "project_id", "description"]) {
          if (body[col] !== undefined) {
            params.push(body[col]);
            sets.push(`${col} = $${params.length}`);
          }
        }
        // Any PATCH is treated as liveness — bump last_seen_at + updated_at.
        sets.push(`last_seen_at = NOW()`, `updated_at = NOW()`);
        params.push(id);
        const row = await db.get<Row>(
          `UPDATE agents SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        return row ? json(mapAgent(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/feedback ----
      if (path === "/v1/feedback" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        await db.query(
          `INSERT INTO feedback (message, email, category, version) VALUES ($1,$2,$3,$4)`,
          [
            requireString(body, "message"),
            (body.email as string) ?? null,
            typeof body.category === "string" ? body.category : "general",
            (body.version as string) ?? null,
          ],
        );
        return json({ status: "ok" }, 201);
      }

      // ---- /v1/schedules ----
      if (path === "/v1/schedules") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          // Parity with LocalStore.listSchedules: agent_id/project_id (exact) and
          // enabled (boolean) filters served DB-side, not silently dropped.
          const where: string[] = [];
          const params: unknown[] = [];
          for (const col of ["agent_id", "project_id"]) {
            const val = url.searchParams.get(col);
            if (val != null && val !== "") {
              params.push(val);
              where.push(`${col} = $${params.length}`);
            }
          }
          const enabledRaw = url.searchParams.get("enabled");
          if (enabledRaw != null && enabledRaw !== "") {
            params.push(enabledRaw === "true" || enabledRaw === "1");
            where.push(`enabled = $${params.length}`);
          }
          const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
          const rows = await db.many<Row>(
            `SELECT * FROM schedules ${clause} ORDER BY created_at DESC LIMIT 200`,
            params,
          );
          return json({ items: rows.map(mapSchedule), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const cron = requireString(body, "cron_expression");
          const command = requireString(body, "command");
          const action = typeof body.action === "string" ? body.action : "custom";
          const row = await db.get<Row>(
            `INSERT INTO schedules (id, name, cron_expression, action, command, parameters, agent_id, project_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              uuid(),
              name,
              cron,
              action,
              command,
              JSON.stringify((body.parameters as Record<string, unknown>) ?? {}),
              (body.agent_id as string) ?? null,
              (body.project_id as string) ?? null,
            ],
          );
          return json(mapSchedule(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const scheduleMatch = path.match(/^\/v1\/schedules\/([^/]+)$/);
      if (scheduleMatch) {
        const id = decodeURIComponent(scheduleMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM schedules WHERE id = $1`, [id]);
          return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const sets: string[] = [];
          const params: unknown[] = [];
          for (const col of ["enabled", "last_run", "next_run", "run_count"]) {
            if (body[col] !== undefined) {
              params.push(body[col]);
              sets.push(`${col} = $${params.length}`);
            }
          }
          if (sets.length === 0) {
            const row = await db.get<Row>(`SELECT * FROM schedules WHERE id = $1`, [id]);
            return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
          }
          sets.push(`updated_at = NOW()`);
          params.push(id);
          const row = await db.get<Row>(
            `UPDATE schedules SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
            params,
          );
          return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM schedules WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- /v1/webhooks ----
      if (path === "/v1/webhooks") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(`SELECT * FROM webhooks ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapWebhook), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const u = requireString(body, "url");
          const row = await db.get<Row>(
            `INSERT INTO webhooks (id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING *`,
            [
              uuid(),
              u,
              JSON.stringify(Array.isArray(body.events) ? body.events : []),
              (body.secret as string) ?? null,
            ],
          );
          return json(mapWebhook(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const webhookMatch = path.match(/^\/v1\/webhooks\/([^/]+)$/);
      if (webhookMatch) {
        const id = decodeURIComponent(webhookMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM webhooks WHERE id = $1`, [id]);
          return row ? json(mapWebhook(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM webhooks WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// OpenAPI document — source of truth for the generated SDK.
// ---------------------------------------------------------------------------

export function telephonyOpenApi(version: string): Record<string, unknown> {
  const listResponse = (ref: string) => ({
    type: "object",
    properties: {
      items: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      total: { type: "integer" },
    },
    required: ["items", "total"],
  });
  const contact = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
      email: { type: "string", nullable: true },
      agent_id: { type: "string", nullable: true },
      project_id: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["id", "name", "phone", "tags", "metadata", "created_at", "updated_at"],
  };
  const str = { type: "string" };
  const strN = { type: "string", nullable: true };
  const intN = { type: "integer", nullable: true };
  const obj = { type: "object", additionalProperties: true };
  const project = {
    type: "object",
    properties: {
      id: str,
      name: str,
      path: str,
      description: strN,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "path", "created_at", "updated_at"],
  };
  const agent = {
    type: "object",
    properties: {
      id: str,
      name: str,
      description: strN,
      session_id: strN,
      project_id: strN,
      capabilities: { type: "array", items: str },
      permissions: { type: "array", items: str },
      status: str,
      metadata: obj,
      last_seen_at: str,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "status", "created_at", "updated_at"],
  };
  const schedule = {
    type: "object",
    properties: {
      id: str,
      name: str,
      cron_expression: str,
      action: str,
      command: str,
      parameters: obj,
      agent_id: strN,
      project_id: strN,
      enabled: { type: "boolean" },
      last_run: strN,
      next_run: strN,
      run_count: { type: "integer" },
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "cron_expression", "action", "command", "created_at", "updated_at"],
  };
  const webhook = {
    type: "object",
    properties: {
      id: str,
      url: str,
      events: { type: "array", items: str },
      secret_configured: { type: "boolean" },
      active: { type: "boolean" },
      created_at: str,
    },
    required: ["id", "url", "events", "secret_configured", "active", "created_at"],
  };
  const phoneNumber = {
    type: "object",
    properties: {
      id: str,
      number: str,
      country: str,
      capabilities: { type: "array", items: str },
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      friendly_name: strN,
      status: str,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "number", "status", "created_at", "updated_at"],
  };
  const message = {
    type: "object",
    properties: {
      id: str,
      type: str,
      from_number: str,
      to_number: str,
      body: strN,
      media_url: strN,
      status: str,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      error_message: strN,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "type", "from_number", "to_number", "status", "created_at", "updated_at"],
  };
  const call = {
    type: "object",
    properties: {
      id: str,
      direction: str,
      from_number: str,
      to_number: str,
      status: str,
      duration: intN,
      recording_url: strN,
      transcription: strN,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      metadata: obj,
      started_at: str,
      ended_at: strN,
      created_at: str,
    },
    required: ["id", "direction", "from_number", "to_number", "status", "started_at", "created_at"],
  };
  const voicemail = {
    type: "object",
    properties: {
      id: str,
      call_id: strN,
      from_number: str,
      to_number: str,
      recording_url: strN,
      local_path: strN,
      transcription: strN,
      duration: intN,
      listened: { type: "boolean" },
      agent_id: strN,
      project_id: strN,
      created_at: str,
    },
    required: ["id", "from_number", "to_number", "listened", "created_at"],
  };
  return {
    openapi: "3.0.3",
    info: { title: "Telephony", version, description: "@hasna/telephony self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Contact: contact,
        ContactInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            agent_id: { type: "string", nullable: true },
            project_id: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["name", "phone"],
        },
        ContactPatch: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        ContactList: listResponse("Contact"),
        Project: project,
        ProjectInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            description: { type: "string", nullable: true },
          },
          required: ["name", "path"],
        },
        ProjectList: listResponse("Project"),
        Agent: agent,
        AgentInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string", nullable: true },
            session_id: { type: "string", nullable: true },
            project_id: { type: "string", nullable: true },
            capabilities: { type: "array", items: { type: "string" } },
            permissions: { type: "array", items: { type: "string" } },
            force: { type: "boolean", description: "Force takeover of a name held by another session" },
          },
          required: ["name"],
        },
        AgentList: listResponse("Agent"),
        Schedule: schedule,
        ScheduleInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            cron_expression: { type: "string" },
            command: { type: "string" },
            action: { type: "string" },
            parameters: { type: "object", additionalProperties: true },
          },
          required: ["name", "cron_expression", "command"],
        },
        ScheduleList: listResponse("Schedule"),
        Webhook: webhook,
        WebhookInput: {
          type: "object",
          properties: {
            url: { type: "string" },
            events: { type: "array", items: { type: "string" } },
            secret: { type: "string", nullable: true },
          },
          required: ["url"],
        },
        WebhookList: listResponse("Webhook"),
        PhoneNumber: phoneNumber,
        PhoneNumberList: listResponse("PhoneNumber"),
        Message: message,
        MessageList: listResponse("Message"),
        Call: call,
        CallList: listResponse("Call"),
        Voicemail: voicemail,
        VoicemailList: listResponse("Voicemail"),
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/contacts": {
        get: {
          operationId: "listContacts",
          summary: "List contacts",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ContactList" } } } },
          },
        },
        post: {
          operationId: "createContact",
          summary: "Create a contact",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
      },
      "/v1/contacts/{id}": {
        get: {
          operationId: "getContact",
          summary: "Fetch a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        patch: {
          operationId: "updateContact",
          summary: "Update a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactPatch" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        delete: {
          operationId: "deleteContact",
          summary: "Delete a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectList" } } } },
          },
        },
        post: {
          operationId: "createProject",
          summary: "Create a project",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Fetch a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
        delete: {
          operationId: "deleteProject",
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/agents": {
        get: {
          operationId: "listAgents",
          summary: "List agents",
          parameters: [
            { name: "agent_id", in: "query", schema: { type: "string" }, description: "Exact agent id" },
            { name: "project_id", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/AgentList" } } } },
          },
        },
        post: {
          operationId: "registerAgent",
          summary: "Register an agent",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AgentInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          },
        },
      },
      "/v1/numbers": {
        get: {
          operationId: "listNumbers",
          summary: "List phone numbers",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "number", in: "query", schema: { type: "string" }, description: "Exact E.164 number lookup" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PhoneNumberList" } } } },
          },
        },
      },
      "/v1/numbers/available": {
        get: {
          operationId: "searchAvailableNumbers",
          summary: "Search available phone numbers to buy (server-side Twilio proxy)",
          description:
            "Live passthrough to Twilio using the server's credential. Returns 501 when the server has no Twilio credential configured, 502 on an upstream Twilio error.",
          parameters: [
            { name: "country", in: "query", schema: { type: "string" }, description: "ISO country code (default US)" },
            { name: "area_code", in: "query", schema: { type: "string" } },
            { name: "contains", in: "query", schema: { type: "string" } },
            { name: "sms_enabled", in: "query", schema: { type: "boolean" } },
            { name: "voice_enabled", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            phoneNumber: { type: "string" },
                            friendlyName: { type: "string" },
                            locality: { type: "string" },
                            region: { type: "string" },
                            capabilities: {
                              type: "object",
                              properties: { voice: { type: "boolean" }, sms: { type: "boolean" }, mms: { type: "boolean" } },
                            },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/numbers/twilio": {
        get: {
          operationId: "listTwilioNumbers",
          summary: "List numbers owned in the Twilio account (server-side Twilio proxy)",
          description:
            "Live passthrough to Twilio using the server's credential. Returns 501 when the server has no Twilio credential configured, 502 on an upstream Twilio error.",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            sid: { type: "string" },
                            phoneNumber: { type: "string" },
                            friendlyName: { type: "string" },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/voices": {
        get: {
          operationId: "listVoices",
          summary: "List available TTS voices (server-side ElevenLabs proxy)",
          description:
            "Live passthrough to ElevenLabs using the server's credential. Returns 501 when the server has no ElevenLabs credential configured, 502 on an upstream ElevenLabs error.",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            voice_id: { type: "string" },
                            name: { type: "string" },
                            category: { type: "string" },
                            description: { type: "string" },
                          },
                        },
                      },
                      total: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/v1/messages": {
        get: {
          operationId: "listMessages",
          summary: "List messages",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" }, description: "Case-insensitive substring match over message body" },
            { name: "number", in: "query", schema: { type: "string" }, description: "Conversation filter: messages to or from this number" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/MessageList" } } } },
          },
        },
      },
      "/v1/calls": {
        get: {
          operationId: "listCalls",
          summary: "List calls",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/CallList" } } } },
          },
        },
      },
      "/v1/voicemails": {
        get: {
          operationId: "listVoicemails",
          summary: "List voicemails",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "listened", in: "query", schema: { type: "boolean" }, description: "Filter by listened state (false => unheard only)" },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/VoicemailList" } } } },
          },
        },
      },
      "/v1/agents/{id}": {
        get: {
          operationId: "getAgent",
          summary: "Fetch an agent by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          },
        },
      },
      "/v1/schedules": {
        get: {
          operationId: "listSchedules",
          summary: "List schedules",
          parameters: [
            { name: "agent_id", in: "query", schema: { type: "string" } },
            { name: "project_id", in: "query", schema: { type: "string" } },
            { name: "enabled", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleList" } } } },
          },
        },
        post: {
          operationId: "createSchedule",
          summary: "Create a schedule",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Schedule" } } } },
          },
        },
      },
      "/v1/webhooks": {
        get: {
          operationId: "listWebhooks",
          summary: "List webhooks",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookList" } } } },
          },
        },
        post: {
          operationId: "createWebhook",
          summary: "Create a webhook",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export interface StartServeOptions {
  port?: number;
  hostname?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningServe {
  port: number;
  hostname: string;
  stop: () => Promise<void>;
}

/**
 * Start the telephony HTTP service on Bun. Opens a PURE-REMOTE cloud pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export async function startTelephonyServe(options: StartServeOptions = {}): Promise<RunningServe> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_TELEPHONY_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = resolveVersion();

  normalizeCloudDatabaseUrl(env);
  const client = createTelephonyCloudClient();
  const store = new ApiKeyStore(client);
  // DDL (the api_keys table) is owned by the migration task (run as the DB
  // owner role); the service connects with a DML-only app role, so it must NOT
  // attempt CREATE TABLE here. The api_keys schema is a deploy prerequisite
  // (bun scripts/apply-cloud-migrations.mjs).
  const verifier = verifyApiKey({
    app: TELEPHONY_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        // Never log tokens/keys — kid + reason only.
        console.warn(
          `[telephony-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`,
        );
      }
    },
  });

  const handler = createServeHandler({ client, verifier, store, version });

  const BunGlobal = (
    globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } }
  ).Bun;
  if (!BunGlobal?.serve) {
    throw new Error("telephony-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(
    `[telephony-serve] listening on http://${hostname}:${server.port} (mode=cloud, version=${version})`,
  );

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    },
  };
}
