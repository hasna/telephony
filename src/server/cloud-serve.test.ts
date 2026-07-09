import { describe, expect, it } from "bun:test";
import { mintApiKey, verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import { createServeHandler, telephonyOpenApi, type ServeDeps } from "./cloud-serve.js";
import type { PoolQueryClient } from "../generated/storage-kit/index.js";

// -------------------------------------------------------------------------
// In-memory shim of the storage-kit PoolQueryClient — just enough of the
// contacts + api_keys surface to exercise the serve handler without Postgres.
// -------------------------------------------------------------------------
function makeShimClient(): PoolQueryClient {
  const contacts: Record<string, Record<string, unknown>>[] = [] as never;
  const webhooks: Record<string, unknown>[] = [];
  const rows: Record<string, unknown>[] = [];

  const run = (sql: string, params: readonly unknown[] = []): { rows: Record<string, unknown>[]; rowCount: number } => {
    const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (s.startsWith("select 1")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
    // api_keys revocation lookups: never revoked in this shim.
    if (s.includes("from api_keys")) return { rows: [], rowCount: 0 };
    if (s.startsWith("insert into contacts")) {
      const now = new Date();
      const row = {
        id: params[0],
        name: params[1],
        phone: params[2],
        email: params[3] ?? null,
        agent_id: params[4] ?? null,
        project_id: params[5] ?? null,
        notes: params[6] ?? null,
        tags: params[7],
        metadata: params[8],
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("select count(*)::text as count from contacts")) {
      return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    }
    if (s.startsWith("select * from contacts where id")) {
      const found = rows.find((r) => r.id === params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (s.startsWith("select * from contacts")) {
      return { rows: [...rows], rowCount: rows.length };
    }
    if (s.startsWith("delete from contacts where id")) {
      const idx = rows.findIndex((r) => r.id === params[0]);
      if (idx >= 0) {
        rows.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (s.startsWith("insert into webhooks")) {
      const now = new Date();
      const row = {
        id: params[0],
        url: params[1],
        events: params[2],
        secret: params[3] ?? null,
        active: true,
        created_at: now,
      };
      webhooks.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (s.startsWith("select * from webhooks where id")) {
      const found = webhooks.find((r) => r.id === params[0]);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
    }
    if (s.startsWith("select * from webhooks")) {
      return { rows: [...webhooks], rowCount: webhooks.length };
    }
    if (s.startsWith("delete from webhooks where id")) {
      const idx = webhooks.findIndex((r) => r.id === params[0]);
      if (idx >= 0) {
        webhooks.splice(idx, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    async query(sql: string, params?: readonly unknown[]) {
      return run(sql, params);
    },
    async many(sql: string, params?: readonly unknown[]) {
      return run(sql, params).rows;
    },
    async get(sql: string, params?: readonly unknown[]) {
      return run(sql, params).rows[0] ?? null;
    },
    async one(sql: string, params?: readonly unknown[]) {
      const r = run(sql, params).rows;
      if (r.length !== 1) throw new Error("expected one row");
      return r[0];
    },
    async execute(sql: string, params?: readonly unknown[]) {
      run(sql, params);
    },
    pool: {} as never,
    async transaction<T>(fn: (c: unknown) => Promise<T>) {
      return fn(client);
    },
    async close() {},
  };
  return client as unknown as PoolQueryClient;
}

const SIGNING = "test-signing-secret-not-a-real-key";

function deps(): ServeDeps {
  const client = makeShimClient();
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({ app: "telephony", signingSecret: SIGNING, isRevoked: store.isRevoked });
  return { client, verifier, store, version: "9.9.9" };
}

describe("telephony cloud serve", () => {
  it("serves public probes with { status, version, mode }", async () => {
    const handler = createServeHandler(deps());
    for (const path of ["/health", "/version"]) {
      const res = await handler(new Request(`http://x${path}`));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; version: string; mode: string };
      expect(body.version).toBe("9.9.9");
      expect(body.mode).toBe("cloud");
      expect(body.status).toBeTruthy();
    }
    const ready = await handler(new Request("http://x/ready"));
    expect(ready.status).toBe(200);
  });

  it("publishes an OpenAPI document with v1 paths and the apiKey scheme", async () => {
    const doc = telephonyOpenApi("1.2.3") as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(10);
    expect(doc.paths["/v1/contacts"]).toBeDefined();
    expect(doc.components.securitySchemes.apiKey).toBeDefined();
  });

  it("rejects unauthenticated /v1 access with 401", async () => {
    const handler = createServeHandler(deps());
    const res = await handler(new Request("http://x/v1/contacts"));
    expect(res.status).toBe(401);
  });

  it("exposes the Twilio-proxy read routes (not captured as numbers/:id)", async () => {
    // Ensure the server has no Twilio credential in this test process so the
    // proxy resolves deterministically to 501 (route EXISTS) rather than a live
    // call. This proves the diagnosis fix: GET /v1/numbers/available is no
    // longer a 404, and is matched BEFORE the /v1/numbers/:id single-GET.
    const twilioEnv = [
      "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
      "HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID", "HASNAXYZ_TWILIO_LIVE_AUTH_TOKEN", "HASNAXYZ_TWILIO_LIVE_PHONE_NUMBER",
    ];
    const saved = twilioEnv.map((k) => [k, process.env[k]] as const);
    for (const k of twilioEnv) delete process.env[k];
    try {
      const handler = createServeHandler(deps());
      const key = mintApiKey({ app: "telephony", scopes: ["telephony:*"], signingSecret: SIGNING }).token;
      const auth = { "x-api-key": key };

      // Unauthenticated → 401 (auth enforced before Twilio).
      expect((await handler(new Request("http://x/v1/numbers/available"))).status).toBe(401);

      for (const path of ["/v1/numbers/available?country=US&area_code=415", "/v1/numbers/twilio"]) {
        const res = await handler(new Request(`http://x${path}`, { headers: auth }));
        expect(res.status).toBe(501);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe("twilio_not_configured");
      }
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  });

  it("does a full authenticated contacts CRUD roundtrip", async () => {
    const handler = createServeHandler(deps());
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:*"], signingSecret: SIGNING }).token;
    const auth = { "x-api-key": key, "content-type": "application/json" };

    const created = await handler(
      new Request("http://x/v1/contacts", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name: "Synthetic", phone: "+15005550006", tags: ["qa"] }),
      }),
    );
    expect(created.status).toBe(201);
    const contact = (await created.json()) as { id: string; name: string; tags: string[] };
    expect(contact.name).toBe("Synthetic");
    expect(contact.tags).toEqual(["qa"]);

    const got = await handler(new Request(`http://x/v1/contacts/${contact.id}`, { headers: auth }));
    expect(got.status).toBe(200);

    const list = await handler(new Request("http://x/v1/contacts", { headers: auth }));
    const listBody = (await list.json()) as { total: number; items: unknown[] };
    expect(listBody.total).toBe(1);

    const del = await handler(
      new Request(`http://x/v1/contacts/${contact.id}`, { method: "DELETE", headers: auth }),
    );
    expect(del.status).toBe(204);

    const gone = await handler(new Request(`http://x/v1/contacts/${contact.id}`, { headers: auth }));
    expect(gone.status).toBe(404);
  });

  it("never exposes webhook signing secrets from create/get/list responses", async () => {
    const handler = createServeHandler(deps());
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:*"], signingSecret: SIGNING }).token;
    const auth = { "x-api-key": key, "content-type": "application/json" };

    const created = await handler(
      new Request("http://x/v1/webhooks", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          url: "https://example.com/hook",
          events: ["sms.inbound"],
          secret: "synthetic-signing-secret",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as Record<string, unknown>;
    expect(createdBody.secret_configured).toBe(true);
    expect(createdBody.secret).toBeUndefined();

    const got = await handler(new Request(`http://x/v1/webhooks/${createdBody.id}`, { headers: auth }));
    expect(got.status).toBe(200);
    const gotBody = (await got.json()) as Record<string, unknown>;
    expect(gotBody.secret_configured).toBe(true);
    expect(gotBody.secret).toBeUndefined();

    const listed = await handler(new Request("http://x/v1/webhooks", { headers: auth }));
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { items: Record<string, unknown>[] };
    expect(listedBody.items[0]!.secret_configured).toBe(true);
    expect(listedBody.items[0]!.secret).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Parity: cloud list filters must be served DB-side, not by scanning a
  // capped page client-side (the split-brain bug at fleet scale).
  // -----------------------------------------------------------------------
  function capturingDeps(): { deps: ServeDeps; sql: { text: string; params: readonly unknown[] }[] } {
    const sql: { text: string; params: readonly unknown[] }[] = [];
    const run = (text: string, params: readonly unknown[] = []) => {
      const s = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (s.startsWith("select 1")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (s.includes("from api_keys")) return { rows: [], rowCount: 0 };
      if (s.startsWith("select")) sql.push({ text: s, params });
      return { rows: [], rowCount: 0 };
    };
    const client = {
      async query(t: string, p?: readonly unknown[]) { return run(t, p); },
      async many(t: string, p?: readonly unknown[]) { return run(t, p).rows; },
      async get(t: string, p?: readonly unknown[]) { return run(t, p).rows[0] ?? null; },
      async one(t: string, p?: readonly unknown[]) { return run(t, p).rows[0]; },
      async execute(t: string, p?: readonly unknown[]) { run(t, p); },
      pool: {} as never,
      async transaction<T>(fn: (c: unknown) => Promise<T>) { return fn(client); },
      async close() {},
    } as unknown as PoolQueryClient;
    const store = new ApiKeyStore(client);
    const verifier = verifyApiKey({ app: "telephony", signingSecret: SIGNING, isRevoked: store.isRevoked });
    return { deps: { client, verifier, store, version: "9.9.9" }, sql };
  }

  it("filters /v1/numbers by exact number DB-side (not a client scan)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/numbers?number=%2B15005550006", { headers: { "x-api-key": key } }));
    const q = sql.find((r) => r.text.includes("from phone_numbers"))!;
    expect(q.text).toContain("number = $1");
    expect(q.params).toEqual(["+15005550006"]);
  });

  it("searches /v1/messages by body substring DB-side (full-table, not a page)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/messages?search=hello", { headers: { "x-api-key": key } }));
    const q = sql.find((r) => r.text.includes("from messages"))!;
    expect(q.text).toContain("body ilike $1");
    expect(q.params).toEqual(["%hello%"]);
  });

  it("filters /v1/messages conversation by number DB-side (from OR to)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/messages?number=%2B15005550006", { headers: { "x-api-key": key } }));
    const q = sql.find((r) => r.text.includes("from messages"))!;
    expect(q.text).toContain("(from_number = $1 or to_number = $1)");
    expect(q.params).toEqual(["+15005550006"]);
  });

  it("serves GET /v1/agents/:id DB-side (cloud getAgent by id must not 404 the route)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/agents/agent-123", { headers: { "x-api-key": key } }));
    // Before the fix the route did not exist, so no SELECT against agents fired.
    const q = sql.find((r) => r.text.includes("from agents where id"))!;
    expect(q).toBeDefined();
    expect(q.params).toEqual(["agent-123"]);
  });

  it("filters /v1/voicemails by listened DB-side (--unheard must not be dropped)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/voicemails?listened=false", { headers: { "x-api-key": key } }));
    const q = sql.find((r) => r.text.includes("from voicemails"))!;
    expect(q.text).toContain("listened = $1");
    // Bound as a real boolean (not the string "false") so Postgres compares boolean = boolean.
    expect(q.params).toEqual([false]);
  });

  it("filters /v1/schedules by agent_id/project_id/enabled DB-side (not silently dropped)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(
      new Request("http://x/v1/schedules?agent_id=ag1&enabled=true", { headers: { "x-api-key": key } }),
    );
    const q = sql.find((r) => r.text.includes("from schedules"))!;
    expect(q.text).toContain("agent_id = $1");
    expect(q.text).toContain("enabled = $2");
    expect(q.params).toEqual(["ag1", true]);
  });

  it("filters /v1/contacts by agent_id/project_id DB-side (not silently dropped)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(
      new Request("http://x/v1/contacts?agent_id=ag1&project_id=pr1", { headers: { "x-api-key": key } }),
    );
    const q = sql.find((r) => r.text.startsWith("select * from contacts"))!;
    expect(q.text).toContain("agent_id = $1");
    expect(q.text).toContain("project_id = $2");
    expect(q.params).toEqual(["ag1", "pr1"]);
  });

  it("filters /v1/agents by project_id DB-side (not silently dropped)", async () => {
    const { deps: d, sql } = capturingDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    await handler(new Request("http://x/v1/agents?project_id=pr1", { headers: { "x-api-key": key } }));
    const q = sql.find((r) => r.text.includes("from agents") && r.text.includes("status != 'archived'"))!;
    expect(q.text).toContain("project_id = $1");
    expect(q.params).toEqual(["pr1"]);
  });

  // ---------------------------------------------------------------------
  // Parity: POST /v1/agents must replicate LocalStore.registerAgent — name
  // normalization + active-session conflict / force-takeover semantics.
  // ---------------------------------------------------------------------
  function agentRegisterDeps(existing?: Record<string, unknown>): {
    deps: ServeDeps;
    sql: { text: string; params: readonly unknown[] }[];
  } {
    const sql: { text: string; params: readonly unknown[] }[] = [];
    const run = (text: string, params: readonly unknown[] = []) => {
      const s = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (s.startsWith("select 1")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
      if (s.includes("from api_keys")) return { rows: [], rowCount: 0 };
      sql.push({ text: s, params });
      if (s.includes("from agents where lower(name)")) {
        return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
      }
      if (s.startsWith("insert into agents")) {
        return {
          rows: [
            {
              id: params[0],
              name: params[1],
              description: params[2] ?? null,
              session_id: params[3] ?? null,
              project_id: params[4] ?? null,
              capabilities: params[5],
              permissions: params[6],
              status: "active",
              metadata: "{}",
              last_seen_at: new Date(),
              created_at: new Date(),
              updated_at: new Date(),
            },
          ],
          rowCount: 1,
        };
      }
      if (s.startsWith("update agents")) return { rows: [existing ?? {}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    };
    const client = {
      async query(t: string, p?: readonly unknown[]) { return run(t, p); },
      async many(t: string, p?: readonly unknown[]) { return run(t, p).rows; },
      async get(t: string, p?: readonly unknown[]) { return run(t, p).rows[0] ?? null; },
      async one(t: string, p?: readonly unknown[]) { return run(t, p).rows[0]; },
      async execute(t: string, p?: readonly unknown[]) { run(t, p); },
      pool: {} as never,
      async transaction<T>(fn: (c: unknown) => Promise<T>) { return fn(client); },
      async close() {},
    } as unknown as PoolQueryClient;
    const store = new ApiKeyStore(client);
    const verifier = verifyApiKey({ app: "telephony", signingSecret: SIGNING, isRevoked: store.isRevoked });
    return { deps: { client, verifier, store, version: "9.9.9" }, sql };
  }

  it("normalizes the agent name to lowercase when registering a new agent", async () => {
    const { deps: d, sql } = agentRegisterDeps();
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:write"], signingSecret: SIGNING }).token;
    const res = await handler(
      new Request("http://x/v1/agents", {
        method: "POST",
        headers: { "x-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ name: "  Brutus  ", session_id: "sess-A" }),
      }),
    );
    expect(res.status).toBe(201);
    const ins = sql.find((r) => r.text.startsWith("insert into agents"))!;
    expect(ins.params[1]).toBe("brutus");
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("brutus");
  });

  it("returns a 409 conflict when the name is held by another active session", async () => {
    const existing = {
      id: "ag-1",
      name: "brutus",
      description: null,
      session_id: "sess-A",
      project_id: null,
      capabilities: "[]",
      permissions: '["*"]',
      status: "active",
      metadata: "{}",
      last_seen_at: new Date(), // fresh => not stale
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { deps: d } = agentRegisterDeps(existing);
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:write"], signingSecret: SIGNING }).token;
    const res = await handler(
      new Request("http://x/v1/agents", {
        method: "POST",
        headers: { "x-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ name: "Brutus", session_id: "sess-B" }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; existing_agent: { id: string } };
    expect(body.error).toBe("conflict");
    expect(body.existing_agent.id).toBe("ag-1");
  });

  it("force-takes over a held name (no conflict) via --force", async () => {
    const existing = {
      id: "ag-1",
      name: "brutus",
      session_id: "sess-A",
      capabilities: "[]",
      permissions: '["*"]',
      status: "active",
      metadata: "{}",
      last_seen_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };
    const { deps: d, sql } = agentRegisterDeps(existing);
    const handler = createServeHandler(d);
    const key = mintApiKey({ app: "telephony", scopes: ["telephony:write"], signingSecret: SIGNING }).token;
    const res = await handler(
      new Request("http://x/v1/agents", {
        method: "POST",
        headers: { "x-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ name: "Brutus", session_id: "sess-B", force: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(sql.some((r) => r.text.startsWith("update agents"))).toBe(true);
  });

  it("enforces scopes: a read-only key cannot write", async () => {
    const handler = createServeHandler(deps());
    const roKey = mintApiKey({ app: "telephony", scopes: ["telephony:read"], signingSecret: SIGNING }).token;
    const res = await handler(
      new Request("http://x/v1/contacts", {
        method: "POST",
        headers: { "x-api-key": roKey, "content-type": "application/json" },
        body: JSON.stringify({ name: "n", phone: "+1" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
