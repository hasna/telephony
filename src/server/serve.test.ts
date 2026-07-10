import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTwilioSignature, resetTelephonySafetyState } from "../lib/safety.js";
import { resetStore } from "../lib/store/index.js";

let server: ReturnType<typeof Bun.serve> | undefined;
let tempDir: string | undefined;

const originalDbPath = process.env.HASNA_TELEPHONY_DB_PATH;
const restCredentialEnvName = ["TELEPHONY", "REST", "API", "KEY"].join("_");
const twilioCredentialEnvName = ["TWILIO", "AUTH", "TOKEN"].join("_");
const originalRestCredential = process.env[restCredentialEnvName];
const originalTwilioCredential = process.env[twilioCredentialEnvName];
const originalProviderMode = process.env.TELEPHONY_PROVIDER_MODE;
const originalDailyQuota = process.env.TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION;
const originalQuotaWindow = process.env.TELEPHONY_MUTATION_QUOTA_WINDOW_MS;
const originalRetention = process.env.TELEPHONY_OPERATION_RETENTION_MS;
const clientStoreEnvNames = [
  "HASNA_TELEPHONY_STORAGE_MODE",
  "HASNA_TELEPHONY_MODE",
  "HASNA_TELEPHONY_API_URL",
  "HASNA_TELEPHONY_API_KEY",
  "TELEPHONY_API_URL",
  "TELEPHONY_API_KEY",
] as const;
const originalClientStoreEnv = new Map(clientStoreEnvNames.map((name) => [name, process.env[name]]));

function clearClientStoreEnv(): void {
  for (const name of clientStoreEnvNames) delete process.env[name];
  resetStore();
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restCredential(): string {
  return ["test", "rest", "credential"].join("-");
}

function webhookCredential(): string {
  return ["test", "webhook", "credential"].join("-");
}

function authHeaders(): Record<string, string> {
  return { Authorization: ["Bearer", restCredential()].join(" ") };
}

function startIsolatedServer() {
  clearClientStoreEnv();
  tempDir = mkdtempSync(join(tmpdir(), "telephony-server-test-"));
  process.env.HASNA_TELEPHONY_DB_PATH = join(tempDir, "telephony.db");
  Object.assign(process.env, { [restCredentialEnvName]: restCredential() });
}

function signTwilioWebhook(port: number, path: string, body: string, token: string): string {
  return computeTwilioSignature(`http://127.0.0.1:${port}${path}`, Object.fromEntries(new URLSearchParams(body)), token);
}

afterEach(async () => {
  server?.stop(true);
  server = undefined;
  resetTelephonySafetyState();

  const { stopScheduler } = await import("../lib/scheduler.js");
  const { closeDatabase } = await import("../db/database.js");
  stopScheduler();
  closeDatabase();
  resetStore();

  if (originalDbPath === undefined) delete process.env.HASNA_TELEPHONY_DB_PATH;
  else process.env.HASNA_TELEPHONY_DB_PATH = originalDbPath;
  if (originalRestCredential === undefined) delete process.env[restCredentialEnvName];
  else Object.assign(process.env, { [restCredentialEnvName]: originalRestCredential });
  if (originalTwilioCredential === undefined) delete process.env[twilioCredentialEnvName];
  else Object.assign(process.env, { [twilioCredentialEnvName]: originalTwilioCredential });
  if (originalProviderMode === undefined) delete process.env.TELEPHONY_PROVIDER_MODE;
  else process.env.TELEPHONY_PROVIDER_MODE = originalProviderMode;
  if (originalDailyQuota === undefined) delete process.env.TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION;
  else process.env.TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION = originalDailyQuota;
  if (originalQuotaWindow === undefined) delete process.env.TELEPHONY_MUTATION_QUOTA_WINDOW_MS;
  else process.env.TELEPHONY_MUTATION_QUOTA_WINDOW_MS = originalQuotaWindow;
  if (originalRetention === undefined) delete process.env.TELEPHONY_OPERATION_RETENTION_MS;
  else process.env.TELEPHONY_OPERATION_RETENTION_MS = originalRetention;
  for (const name of clientStoreEnvNames) restoreEnv(name, originalClientStoreEnv.get(name));
  resetStore();

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("REST API request parsing", () => {
  it("returns 400 for malformed JSON request bodies", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: "{\"url\":",
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Invalid JSON request body" });
  });

  it("matches JSON content types case-insensitively", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "Application/Json", ...authHeaders() },
      body: "{\"url\":",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON request body" });
  });

  it("returns 400 for JSON bodies that are not objects", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    for (const body of ["[]", "null", "\"hello\"", "42", "true"]) {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "JSON request body must be an object" });
    }
  });
});

describe("REST and Twilio safety gates", () => {
  it("rejects REST API requests when no API key is configured", async () => {
    startIsolatedServer();
    delete process.env[restCredentialEnvName];

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/messages`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Telephony REST API is disabled until a REST credential is configured." });
  });

  it("rejects mutating REST requests without a valid API key before destination validation", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+19005550123", body: "blocked" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Telephony REST API authentication required." });
  });

  it("blocks toll-fraud destinations after REST authentication and before provider calls", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ to: "+19005550123", body: "blocked" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "sms destination is blocked by the telephony toll-fraud safety gate." });
  });

  it("queues authenticated provider mutations by default without calling Twilio or writing ledgers", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    const { listMessages } = await import("../db/messages.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sms-queue-1", ...authHeaders() },
      body: JSON.stringify({ to: "+15555550123", body: "queued" }),
    });

    expect(res.status).toBe(202);
    const queued = await res.json() as any;
    expect(queued.status).toBe("queued");
    expect(queued.live_execution).toBe(false);
    expect(queued.operation.operation).toBe("send_sms");
    expect(listMessages()).toEqual([]);

    const queue = await fetch(`http://127.0.0.1:${server.port}/api/safety/queue`, { headers: authHeaders() });
    expect(queue.status).toBe(200);
    const entries = await queue.json() as any[];
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].retentionExpiresAt).toBe("string");

    const retry = await fetch(`http://127.0.0.1:${server.port}/api/safety/queue/${entries[0].id}/retry`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(retry.status).toBe(200);
    expect((await retry.json() as any).attempts).toBe(1);
  });

  it("deduplicates queued mutations by idempotency key", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const first = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sms-dedupe-1", ...authHeaders() },
      body: JSON.stringify({ to: "+15555550124", body: "queued" }),
    });
    const firstBody = await first.json() as any;

    const duplicate = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sms-dedupe-1", ...authHeaders() },
      body: JSON.stringify({ to: "+15555550124", body: "queued again" }),
    });
    const duplicateBody = await duplicate.json() as any;

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(202);
    expect(duplicateBody.status).toBe("duplicate");
    expect(duplicateBody.operation.id).toBe(firstBody.operation.id);
  });

  it("requires idempotency keys before mutating provider operations", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/call/make`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ to: "+15555550125", prompt: "hello" }),
    });

    expect(res.status).toBe(428);
    expect((await res.json() as any).required_headers).toEqual(["Idempotency-Key"]);
  });

  it("enforces per-destination mutation quota before provider execution", async () => {
    startIsolatedServer();
    process.env.TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION = "1";
    process.env.TELEPHONY_MUTATION_QUOTA_WINDOW_MS = "60000";

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const target = "+15555550126";
    const first = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sms-quota-1", ...authHeaders() },
      body: JSON.stringify({ to: target, body: "one" }),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "sms-quota-2", ...authHeaders() },
      body: JSON.stringify({ to: target, body: "two" }),
    });

    expect(second.status).toBe(429);
    expect((await second.json() as any).error).toBe("Telephony mutation quota exceeded for this destination.");
  });

  it("queues live provider mutations until operator approval and sandbox-smoke proof are present", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    const { listMessages } = await import("../db/messages.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/sms/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "sms-live-approval-1",
        "X-Telephony-Provider-Mode": "live_mutating",
        ...authHeaders(),
      },
      body: JSON.stringify({ to: "+15555550127", body: "live blocked" }),
    });

    expect(res.status).toBe(202);
    const body = await res.json() as any;
    expect(body.status).toBe("awaiting_sandbox_smoke");
    expect(body.missing_headers).toEqual(["x-telephony-live-execution", "x-telephony-operator-approval", "x-telephony-sandbox-smoke"]);
    expect(listMessages()).toEqual([]);
  });

  it("provides explicit sandbox and live smoke proof paths without provider side effects", async () => {
    startIsolatedServer();

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const sandbox = await fetch(`http://127.0.0.1:${server.port}/api/safety/smoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telephony-Provider-Mode": "sandbox", ...authHeaders() },
      body: JSON.stringify({ operation: "send_sms", to: "+15555550128" }),
    });
    expect(sandbox.status).toBe(200);
    expect(await sandbox.json()).toMatchObject({
      status: "sandbox_smoke_passed",
      live_execution: false,
      proof_header_for_live_mutation: "x-telephony-sandbox-smoke: passed",
    });

    const invalidProvision = await fetch(`http://127.0.0.1:${server.port}/api/safety/smoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telephony-Provider-Mode": "sandbox", ...authHeaders() },
      body: JSON.stringify({ operation: "provision_number", phone_number: "555", country: "US" }),
    });
    expect(invalidProvision.status).toBe(400);

    const liveBlocked = await fetch(`http://127.0.0.1:${server.port}/api/safety/smoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Telephony-Provider-Mode": "live_mutating", ...authHeaders() },
      body: JSON.stringify({ operation: "send_sms", to: "+15555550128" }),
    });
    expect(liveBlocked.status).toBe(202);
    expect((await liveBlocked.json() as any).status).toBe("live_smoke_blocked");

    const liveReady = await fetch(`http://127.0.0.1:${server.port}/api/safety/smoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telephony-Provider-Mode": "live_mutating",
        "X-Telephony-Operator-Approval": "approved",
        "X-Telephony-Live-Smoke": "approved",
        ...authHeaders(),
      },
      body: JSON.stringify({ operation: "send_sms", to: "+15555550128" }),
    });
    expect(liveReady.status).toBe(200);
    expect((await liveReady.json() as any).status).toBe("live_smoke_ready");
  });

  it("rejects unsigned Twilio webhooks before inbound messages are written", async () => {
    startIsolatedServer();
    Object.assign(process.env, { [twilioCredentialEnvName]: webhookCredential() });

    const { createServer } = await import("./serve.js");
    const { listMessages } = await import("../db/messages.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/webhooks/sms/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "MessageSid=SMunsigned&From=%2B15550000001&To=%2B15550000002&Body=hello",
    });

    expect(res.status).toBe(401);
    expect(listMessages()).toEqual([]);
  });

  it("accepts one signed Twilio webhook and rejects replayed ids", async () => {
    startIsolatedServer();
    Object.assign(process.env, { [twilioCredentialEnvName]: webhookCredential() });

    const { createServer } = await import("./serve.js");
    const { listMessages } = await import("../db/messages.js");
    server = createServer(0);

    const path = "/webhooks/sms/inbound";
    const body = "MessageSid=SMsignedreplay&From=%2B15550000001&To=%2B15550000002&Body=hello";
    const signature = signTwilioWebhook(server.port, path, body, webhookCredential());
    const first = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body,
    });
    expect(first.status).toBe(200);
    expect(listMessages()).toHaveLength(1);

    const replay = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": signature,
      },
      body,
    });

    expect(replay.status).toBe(409);
    expect(listMessages()).toHaveLength(1);
  });
});

describe("cloud-flip read routing", () => {
  const apiUrlEnv = ["HASNA", "TELEPHONY", "API", "URL"].join("_");
  const apiKeyEnv = ["HASNA", "TELEPHONY", "API", "KEY"].join("_");

  it("serves REST read routes from the Store (cloud) — not local sqlite — when flipped", async () => {
    // A machine flipped to cloud runs `telephony serve` as a webhook receiver +
    // dashboard. Its read routes MUST come from the SAME cloud store the inbound
    // handlers write to; reading local sqlite here is the split-brain bug.
    const seenPaths: string[] = [];
    const cloud = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        seenPaths.push(`${req.method} ${u.pathname}`);
        if (req.method === "GET" && u.pathname === "/v1/messages") {
          return new Response(JSON.stringify({ items: [{ id: "cloud-msg-1", body: "from cloud" }] }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ items: [] }), { headers: { "Content-Type": "application/json" } });
      },
    });

    // Isolated (empty) local DB so any accidental local read would return [].
    tempDir = mkdtempSync(join(tmpdir(), "telephony-server-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempDir, "telephony.db");
    Object.assign(process.env, { [restCredentialEnvName]: restCredential() });
    process.env[apiUrlEnv] = `http://127.0.0.1:${cloud.port}`;
    process.env[apiKeyEnv] = ["test", "cloud", "key"].join("-");

    resetStore();

    try {
      const { createServer } = await import("./serve.js");
      server = createServer(0);

      const res = await fetch(`http://127.0.0.1:${server.port}/api/messages`, { headers: authHeaders() });
      expect(res.status).toBe(200);
      // The row came from the cloud stub, proving the read routed through the Store.
      expect(await res.json()).toEqual([{ id: "cloud-msg-1", body: "from cloud" }]);
      expect(seenPaths).toContain("GET /v1/messages");
    } finally {
      cloud.stop(true);
      delete process.env[apiUrlEnv];
      delete process.env[apiKeyEnv];
      resetStore();
    }
  });
});
