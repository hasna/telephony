import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Voicemail, VoicemailRow } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToVoicemail(row: VoicemailRow): Voicemail {
  return { ...row, listened: !!row.listened };
}

export function createVoicemail(
  input: {
    call_id?: string;
    from_number: string;
    to_number: string;
    recording_url?: string;
    local_path?: string;
    transcription?: string;
    duration?: number;
    agent_id?: string;
    project_id?: string;
  },
  db?: Database,
): Voicemail {
  const d = db || getDatabase();
  const id = uuid();

  d.run(
    `INSERT INTO voicemails (id, call_id, from_number, to_number, recording_url, local_path, transcription, duration, agent_id, project_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.call_id || null,
      input.from_number,
      input.to_number,
      input.recording_url || null,
      input.local_path || null,
      input.transcription || null,
      input.duration || null,
      input.agent_id || null,
      input.project_id || null,
      now(),
    ],
  );

  return getVoicemail(id, d)!;
}

export function getVoicemail(id: string, db?: Database): Voicemail | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM voicemails WHERE id = ?").get(id) as VoicemailRow | null;
  return row ? rowToVoicemail(row) : null;
}

export function listVoicemails(filters?: { agent_id?: string; project_id?: string; listened?: boolean }, db?: Database): Voicemail[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.listened !== undefined) { clauses.push("listened = ?"); params.push(filters.listened ? 1 : 0); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (d.prepare(`SELECT * FROM voicemails${where} ORDER BY created_at DESC`).all(...params) as VoicemailRow[]).map(rowToVoicemail);
}

export function markVoicemailListened(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("UPDATE voicemails SET listened = 1 WHERE id = ?", [id]).changes > 0;
}

export function deleteVoicemail(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM voicemails WHERE id = ?", [id]).changes > 0;
}
