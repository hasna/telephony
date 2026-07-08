// Outbound webhook dispatch — reads the registered webhook targets through the
// Store so it honours the client-flip env. On a machine flipped to cloud
// (HASNA_TELEPHONY_API_URL + API_KEY), the targets come from the cloud API, not
// local sqlite; in local mode they come from on-box sqlite. This is the same
// transport the inbound handlers write through, so there is no split-brain.

import { getStore } from "./store/index.js";

export async function dispatchWebhook(event: string, payload: unknown): Promise<void> {
  const all = await getStore().listWebhooks();
  const targets = all.filter((w) => w.active && (w.events.length === 0 || w.events.includes(event)));
  for (const wh of targets) {
    try {
      const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (wh.secret) {
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          "raw",
          encoder.encode(wh.secret),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        );
        const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
        headers["X-Webhook-Signature"] = Array.from(new Uint8Array(sig))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      fetch(wh.url, { method: "POST", headers, body }).catch(() => {});
    } catch {
      // Never let a single misconfigured webhook target break inbound handling.
    }
  }
}
