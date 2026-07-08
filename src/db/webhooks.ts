import type { SqliteAdapter as Database } from "./sqlite-adapter.js";
import type { Webhook, WebhookRow, CreateWebhookInput } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";

function rowToWebhook(row: WebhookRow): Webhook {
  return { ...row, events: JSON.parse(row.events || "[]"), active: !!row.active };
}

export function createWebhook(input: CreateWebhookInput, db?: Database): Webhook {
  const d = db || getDatabase();
  const id = uuid();
  d.run(
    "INSERT INTO webhooks (id, url, events, secret, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, input.url, JSON.stringify(input.events || []), input.secret || null, now()],
  );
  return getWebhook(id, d)!;
}

export function getWebhook(id: string, db?: Database): Webhook | null {
  const d = db || getDatabase();
  const row = d.prepare("SELECT * FROM webhooks WHERE id = ?").get(id) as WebhookRow | null;
  return row ? rowToWebhook(row) : null;
}

export function listWebhooks(db?: Database): Webhook[] {
  const d = db || getDatabase();
  return (d.prepare("SELECT * FROM webhooks ORDER BY created_at DESC").all() as WebhookRow[]).map(rowToWebhook);
}

export function deleteWebhook(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  return d.run("DELETE FROM webhooks WHERE id = ?", [id]).changes > 0;
}
