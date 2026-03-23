import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Message, MessageRow, MessageType, MessageStatus } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToMessage(row: MessageRow): Message {
  return {
    ...row,
    type: row.type as MessageType,
    status: row.status as MessageStatus,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createMessage(
  input: {
    type: MessageType;
    from_number: string;
    to_number: string;
    body?: string;
    media_url?: string;
    status?: MessageStatus;
    agent_id?: string;
    project_id?: string;
    twilio_sid?: string;
  },
  db?: Database,
): Message {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO messages (id, type, from_number, to_number, body, media_url, status, agent_id, project_id, twilio_sid, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    [
      id,
      input.type,
      input.from_number,
      input.to_number,
      input.body || null,
      input.media_url || null,
      input.status || "queued",
      input.agent_id || null,
      input.project_id || null,
      input.twilio_sid || null,
      timestamp,
      timestamp,
    ],
  );

  return getMessage(id, d)!;
}

export function getMessage(id: string, db?: Database): Message | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | null;
  return row ? rowToMessage(row) : null;
}

export function listMessages(
  filters?: { agent_id?: string; project_id?: string; type?: MessageType; limit?: number; offset?: number },
  db?: Database,
): Message[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.type) { clauses.push("type = ?"); params.push(filters.type); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;

  return (d.prepare(`SELECT * FROM messages${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as MessageRow[]).map(rowToMessage);
}

export function searchMessages(query: string, limit?: number, db?: Database): Message[] {
  const d = db || getDatabase();
  const rows = d.prepare(
    `SELECT m.* FROM messages m
     JOIN messages_fts fts ON m.rowid = fts.rowid
     WHERE messages_fts MATCH ?
     ORDER BY rank LIMIT ?`,
  ).all(query, limit || 50) as MessageRow[];
  return rows.map(rowToMessage);
}

export function getConversation(phoneNumber: string, limit?: number, db?: Database): Message[] {
  const d = db || getDatabase();
  return (d.prepare(
    `SELECT * FROM messages WHERE from_number = ? OR to_number = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(phoneNumber, phoneNumber, limit || 50) as MessageRow[]).map(rowToMessage);
}

export function updateMessageStatus(id: string, status: MessageStatus, errorMessage?: string, db?: Database): void {
  const d = db || getDatabase();
  if (errorMessage) {
    d.run("UPDATE messages SET status = ?, error_message = ?, updated_at = ? WHERE id = ?", [status, errorMessage, now(), id]);
  } else {
    d.run("UPDATE messages SET status = ?, updated_at = ? WHERE id = ?", [status, now(), id]);
  }
}
