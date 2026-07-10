import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "../db/database.js";
import { resetStore } from "./store/index.js";
import { dispatchWebhook } from "./webhooks.js";

const cloudEnvNames = [
  "HASNA_TELEPHONY_STORAGE_MODE",
  "HASNA_TELEPHONY_MODE",
  "HASNA_TELEPHONY_API_URL",
  "HASNA_TELEPHONY_API_KEY",
  "TELEPHONY_API_URL",
  "TELEPHONY_API_KEY",
  "HASNA_TELEPHONY_DB_PATH",
] as const;
const originalEnv = new Map(cloudEnvNames.map((name) => [name, process.env[name]]));
const apiKeyEnvName = ["HASNA", "TELEPHONY", "API", "KEY"].join("_");

let tempRoot: string | undefined;

function restoreEnv(): void {
  for (const name of cloudEnvNames) {
    const value = originalEnv.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for webhook dispatch");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterEach(() => {
  restoreEnv();
  resetStore();
  closeDatabase();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("dispatchWebhook", () => {
  it("uses cloud dispatch targets when cloud-flipped, even with an empty local DB", async () => {
    let cloudRequests = 0;
    let targetHits = 0;
    let signatureConfigured = false;

    const target = Bun.serve({
      port: 0,
      async fetch(req) {
        targetHits += 1;
        signatureConfigured = Boolean(req.headers.get("x-webhook-signature"));
        await req.text();
        return new Response("ok");
      },
    });

    const cloud = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (req.method === "GET" && url.pathname === "/v1/internal/webhook-dispatch-targets") {
          cloudRequests += 1;
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "cloud-webhook-1",
                  url: `http://127.0.0.1:${target.port}/hook`,
                  events: ["sms.inbound"],
                  secret_configured: true,
                  secret: "synthetic-signing-secret",
                  active: true,
                  created_at: new Date().toISOString(),
                },
              ],
              total: 1,
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    });

    try {
      tempRoot = mkdtempSync(join(tmpdir(), "telephony-webhook-dispatch-test-"));
      process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "telephony.db");
      process.env.HASNA_TELEPHONY_STORAGE_MODE = "cloud";
      process.env.HASNA_TELEPHONY_API_URL = `http://127.0.0.1:${cloud.port}`;
      process.env[apiKeyEnvName] = ["synthetic", "api", "key"].join("-");
      resetStore();

      await dispatchWebhook("sms.inbound", { id: "msg-1" });
      await waitFor(() => targetHits === 1);

      expect(cloudRequests).toBe(1);
      expect(targetHits).toBe(1);
      expect(signatureConfigured).toBe(true);
    } finally {
      cloud.stop(true);
      target.stop(true);
    }
  });
});
