import type { SqliteAdapter as Database } from "@hasna/cloud";
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

export async function dispatchWebhook(event: string, payload: unknown, db?: Database): Promise<void> {
  const webhooks = listWebhooks(db).filter(w => w.active && (w.events.length === 0 || w.events.includes(event)));
  for (const wh of webhooks) {
    try {
      const body = JSON.stringify({ event, payload, timestamp: now() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (wh.secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", encoder.encode(wh.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
        headers["X-Webhook-Signature"] = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
      }
      fetch(wh.url, { method: "POST", headers, body }).catch(() => {});
    } catch {}
  }
}
