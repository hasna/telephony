import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Call, CallRow, CallDirection, CallStatus } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToCall(row: CallRow): Call {
  return {
    ...row,
    direction: row.direction as CallDirection,
    status: row.status as CallStatus,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createCall(
  input: {
    direction: CallDirection;
    from_number: string;
    to_number: string;
    agent_id?: string;
    project_id?: string;
    twilio_sid?: string;
  },
  db?: Database,
): Call {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO calls (id, direction, from_number, to_number, status, agent_id, project_id, twilio_sid, metadata, started_at, created_at)
     VALUES (?, ?, ?, ?, 'initiated', ?, ?, ?, '{}', ?, ?)`,
    [id, input.direction, input.from_number, input.to_number, input.agent_id || null, input.project_id || null, input.twilio_sid || null, timestamp, timestamp],
  );

  return getCall(id, d)!;
}

export function getCall(id: string, db?: Database): Call | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | null;
  return row ? rowToCall(row) : null;
}

export function listCalls(
  filters?: { agent_id?: string; project_id?: string; direction?: CallDirection; limit?: number },
  db?: Database,
): Call[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.direction) { clauses.push("direction = ?"); params.push(filters.direction); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (d.prepare(`SELECT * FROM calls${where} ORDER BY created_at DESC LIMIT ?`).all(...params, filters?.limit || 50) as CallRow[]).map(rowToCall);
}

export function updateCallStatus(id: string, status: CallStatus, extra?: { duration?: number; recording_url?: string; transcription?: string }, db?: Database): void {
  const d = db || getDatabase();
  const sets: string[] = ["status = ?"];
  const params: unknown[] = [status];

  if (status === "completed" || status === "failed" || status === "canceled") {
    sets.push("ended_at = ?");
    params.push(now());
  }
  if (extra?.duration !== undefined) { sets.push("duration = ?"); params.push(extra.duration); }
  if (extra?.recording_url) { sets.push("recording_url = ?"); params.push(extra.recording_url); }
  if (extra?.transcription) { sets.push("transcription = ?"); params.push(extra.transcription); }

  params.push(id);
  d.run(`UPDATE calls SET ${sets.join(", ")} WHERE id = ?`, params);
}
