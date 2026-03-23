import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { PhoneNumber, PhoneNumberRow, PhoneNumberCapability } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToPhoneNumber(row: PhoneNumberRow): PhoneNumber {
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '["sms","voice"]') as PhoneNumberCapability[],
    status: row.status as PhoneNumber["status"],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createPhoneNumber(
  input: {
    number: string;
    country?: string;
    capabilities?: PhoneNumberCapability[];
    agent_id?: string;
    project_id?: string;
    twilio_sid?: string;
    friendly_name?: string;
  },
  db?: Database,
): PhoneNumber {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO phone_numbers (id, number, country, capabilities, agent_id, project_id, twilio_sid, friendly_name, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)`,
    [
      id,
      input.number,
      input.country || "US",
      JSON.stringify(input.capabilities || ["sms", "voice"]),
      input.agent_id || null,
      input.project_id || null,
      input.twilio_sid || null,
      input.friendly_name || null,
      timestamp,
      timestamp,
    ],
  );

  return getPhoneNumber(id, d)!;
}

export function getPhoneNumber(id: string, db?: Database): PhoneNumber | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM phone_numbers WHERE id = ?").get(id) as PhoneNumberRow | null;
  return row ? rowToPhoneNumber(row) : null;
}

export function getPhoneNumberByNumber(number: string, db?: Database): PhoneNumber | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM phone_numbers WHERE number = ?").get(number) as PhoneNumberRow | null;
  return row ? rowToPhoneNumber(row) : null;
}

export function listPhoneNumbers(filters?: { agent_id?: string; project_id?: string; status?: string }, db?: Database): PhoneNumber[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.status) { clauses.push("status = ?"); params.push(filters.status); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (d.prepare(`SELECT * FROM phone_numbers${where} ORDER BY created_at DESC`).all(...params) as PhoneNumberRow[]).map(rowToPhoneNumber);
}

export function assignPhoneNumber(id: string, agentId?: string, projectId?: string, db?: Database): PhoneNumber | null {
  const d = db || getDatabase();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (agentId !== undefined) { sets.push("agent_id = ?"); params.push(agentId || null); }
  if (projectId !== undefined) { sets.push("project_id = ?"); params.push(projectId || null); }

  params.push(id);
  d.run(`UPDATE phone_numbers SET ${sets.join(", ")} WHERE id = ?`, params);
  return getPhoneNumber(id, d);
}

export function releasePhoneNumberDb(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("UPDATE phone_numbers SET status = 'released', agent_id = NULL, project_id = NULL, updated_at = ? WHERE id = ?", [now(), id]).changes > 0;
}

export function deletePhoneNumber(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM phone_numbers WHERE id = ?", [id]).changes > 0;
}
