import type { SqliteAdapter as Database } from "@hasna/cloud";
import type { Schedule, ScheduleRow, ScheduleAction, CreateScheduleInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToSchedule(row: ScheduleRow): Schedule {
  return {
    ...row,
    action: row.action as ScheduleAction,
    parameters: JSON.parse(row.parameters || "{}") as Record<string, unknown>,
    enabled: !!row.enabled,
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
  };
}

export function createSchedule(input: CreateScheduleInput, db?: Database): Schedule {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  const nextRun = computeNextRun(input.cron_expression);

  d.run(
    `INSERT INTO schedules (id, name, cron_expression, action, command, parameters, agent_id, project_id, enabled, next_run, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '{}', ?, ?)`,
    [
      id,
      input.name,
      input.cron_expression,
      input.action,
      input.command,
      JSON.stringify(input.parameters || {}),
      input.agent_id || null,
      input.project_id || null,
      nextRun,
      timestamp,
      timestamp,
    ],
  );

  return getSchedule(id, d)!;
}

export function getSchedule(id: string, db?: Database): Schedule | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as ScheduleRow | null;
  return row ? rowToSchedule(row) : null;
}

export function listSchedules(filters?: { agent_id?: string; project_id?: string; enabled?: boolean }, db?: Database): Schedule[] {
  const d = db || getDatabase();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.agent_id) { clauses.push("agent_id = ?"); params.push(filters.agent_id); }
  if (filters?.project_id) { clauses.push("project_id = ?"); params.push(filters.project_id); }
  if (filters?.enabled !== undefined) { clauses.push("enabled = ?"); params.push(filters.enabled ? 1 : 0); }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return (d.prepare(`SELECT * FROM schedules${where} ORDER BY created_at DESC`).all(...params) as ScheduleRow[]).map(rowToSchedule);
}

export function enableSchedule(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const nextRun = computeNextRun(getSchedule(id, d)?.cron_expression || "");
  return d.run("UPDATE schedules SET enabled = 1, next_run = ?, updated_at = ? WHERE id = ?", [nextRun, now(), id]).changes > 0;
}

export function disableSchedule(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("UPDATE schedules SET enabled = 0, updated_at = ? WHERE id = ?", [now(), id]).changes > 0;
}

export function deleteSchedule(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM schedules WHERE id = ?", [id]).changes > 0;
}

export function markScheduleRun(id: string, db?: Database): void {
  const d = db || getDatabase();
  const schedule = getSchedule(id, d);
  if (!schedule) return;
  const nextRun = computeNextRun(schedule.cron_expression);
  d.run(
    "UPDATE schedules SET last_run = ?, next_run = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?",
    [now(), nextRun, now(), id],
  );
}

export function getDueSchedules(db?: Database): Schedule[] {
  const d = db || getDatabase();
  const timestamp = now();
  return (d.prepare(
    "SELECT * FROM schedules WHERE enabled = 1 AND (next_run IS NULL OR next_run <= ?)",
  ).all(timestamp) as ScheduleRow[]).map(rowToSchedule);
}

// ---------------------------------------------------------------------------
// Simple cron parser (minute hour dom month dow)
// ---------------------------------------------------------------------------

export function computeNextRun(cronExpression: string): string | null {
  if (!cronExpression) return null;

  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minPart, hourPart] = parts;
  const date = new Date();
  date.setSeconds(0, 0);

  // Simple: if specific minute and hour, find next occurrence
  const min = minPart === "*" ? -1 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? -1 : parseInt(hourPart!, 10);

  if (min >= 0 && hour >= 0) {
    date.setHours(hour, min, 0, 0);
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }
    return date.toISOString();
  }

  // For wildcards, next minute
  date.setMinutes(date.getMinutes() + 1);
  if (min >= 0) date.setMinutes(min);
  if (hour >= 0) date.setHours(hour);

  if (date.getTime() <= Date.now()) {
    if (hour >= 0) date.setDate(date.getDate() + 1);
    else date.setHours(date.getHours() + 1);
  }

  return date.toISOString();
}
