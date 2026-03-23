import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Contact, ContactRow, CreateContactInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToContact(row: ContactRow): Contact {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createContact(input: CreateContactInput, db?: Database): Contact {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO contacts (id, name, phone, email, agent_id, project_id, notes, tags, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
    [
      id,
      input.name,
      input.phone,
      input.email || null,
      input.agent_id || null,
      input.project_id || null,
      input.notes || null,
      JSON.stringify(input.tags || []),
      timestamp,
      timestamp,
    ],
  );

  return getContact(id, d)!;
}

export function getContact(id: string, db?: Database): Contact | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | null;
  return row ? rowToContact(row) : null;
}

export function listContacts(filters?: { agent_id?: string; project_id?: string }, db?: Database): Contact[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (d.prepare(`SELECT * FROM contacts${where} ORDER BY name`).all(...params) as ContactRow[]).map(rowToContact);
}

export function searchContacts(query: string, db?: Database): Contact[] {
  const d = db || getDatabase();
  const pattern = `%${query}%`;
  return (d.prepare(
    "SELECT * FROM contacts WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name",
  ).all(pattern, pattern, pattern) as ContactRow[]).map(rowToContact);
}

export function updateContact(id: string, input: Partial<CreateContactInput>, db?: Database): Contact | null {
  const d = db || getDatabase();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) { sets.push("name = ?"); params.push(input.name); }
  if (input.phone !== undefined) { sets.push("phone = ?"); params.push(input.phone); }
  if (input.email !== undefined) { sets.push("email = ?"); params.push(input.email); }
  if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
  if (input.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(input.tags)); }

  if (sets.length > 0) {
    sets.push("updated_at = ?");
    params.push(now());
    params.push(id);
    d.run(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  return getContact(id, d);
}

export function deleteContact(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM contacts WHERE id = ?", [id]).changes > 0;
}
