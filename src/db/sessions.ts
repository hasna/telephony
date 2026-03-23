import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { CreateSessionInput, Session, SessionRow } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToSession(row: SessionRow): Session {
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createSession(input: CreateSessionInput, db?: Database): Session {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO sessions (id, agent_id, project_id, working_dir, metadata, started_at, last_activity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.agent_id || null,
      input.project_id || null,
      input.working_dir || null,
      JSON.stringify(input.metadata || {}),
      timestamp,
      timestamp,
    ],
  );

  return getSession(id, d)!;
}

export function getSession(id: string, db?: Database): Session | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  return row ? rowToSession(row) : null;
}

export function listSessions(db?: Database): Session[] {
  const d = db || getDatabase();
  return (d.prepare("SELECT * FROM sessions ORDER BY last_activity DESC").all() as SessionRow[]).map(rowToSession);
}

export function updateSessionActivity(id: string, db?: Database): void {
  const d = db || getDatabase();
  d.run("UPDATE sessions SET last_activity = ? WHERE id = ?", [now(), id]);
}
