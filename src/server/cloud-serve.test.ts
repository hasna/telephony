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
