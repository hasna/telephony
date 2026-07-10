import { afterEach, describe, expect, it } from "bun:test";
import { getStore, isCloudStore, resetStore, ApiStore, LocalStore } from "./index.js";
import { HasnaHttpError } from "../../generated/storage-client/index.js";
import type { Agent, AgentConflictError } from "../../types/index.js";

const CLIENT_ENV = [
  "HASNA_TELEPHONY_STORAGE_MODE",
  "HASNA_TELEPHONY_MODE",
  "HASNA_TELEPHONY_API_URL",
  "HASNA_TELEPHONY_API_KEY",
  "TELEPHONY_API_URL",
  "TELEPHONY_API_KEY",
];

function clearEnv(): void {
  for (const k of CLIENT_ENV) delete process.env[k];
  resetStore();
}

afterEach(clearEnv);

describe("telephony Store resolver", () => {
  it("defaults to the LocalStore when nothing is set", () => {
    clearEnv();
    const store = getStore();
    expect(store.transport).toBe("local");
    expect(store).toBeInstanceOf(LocalStore);
    expect(isCloudStore()).toBe(false);
  });

  it("stays local in self_hosted mode without an API key (no silent drift)", () => {
    clearEnv();
    const env = {
      HASNA_TELEPHONY_STORAGE_MODE: "self_hosted",
      HASNA_TELEPHONY_API_URL: "https://telephony.hasna.xyz",
    } as Record<string, string>;
    // resolveStorageClient throws when cloud is requested but misconfigured.
    expect(() => getStore(env)).toThrow();
  });

  it("routes to the ApiStore in self_hosted mode with URL + key", () => {
    clearEnv();
    const env = {
      HASNA_TELEPHONY_STORAGE_MODE: "self_hosted",
      HASNA_TELEPHONY_API_URL: "https://telephony.hasna.xyz",
      HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    const store = getStore(env);
    expect(store.transport).toBe("cloud-http");
    expect(store).toBeInstanceOf(ApiStore);
    expect(isCloudStore(env)).toBe(true);
  });

  it("accepts the canonical cloud alias too", () => {
    clearEnv();
    const env = {
      HASNA_TELEPHONY_STORAGE_MODE: "cloud",
      HASNA_TELEPHONY_API_URL: "https://telephony.hasna.xyz",
      HASNA_TELEPHONY_API_KEY: "hasna_telephony_test_key",
    } as Record<string, string>;
    expect(getStore(env).transport).toBe("cloud-http");
  });
});

describe("ApiStore cloud filters (parity with LocalStore)", () => {
  // A capturing HasnaStorageClient stub that records the query passed to list().
  function captureClient() {
    const calls: { resource: string; query?: Record<string, unknown> }[] = [];
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.hasna.xyz/v1",
      transport: {} as never,
      async list(resource: string, options?: { query?: Record<string, unknown> }) {
        calls.push({ resource, query: options?.query });
        return { items: [], total: 0, cursor: null, raw: {} };
      },
      async get() {
        return null;
      },
      async create() {
        return {} as never;
      },
      async update() {
        return {} as never;
      },
      async delete() {},
    };
    return { client, calls };
  }

  it("sends the listened filter to /v1/voicemails (--unheard not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listVoicemails({ listened: false });
    const call = calls.find((c) => c.resource === "voicemails")!;
    expect(call.query).toEqual({ listened: "false" });
  });

  it("omits listened when the filter is undefined (tri-state)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listVoicemails({ agent_id: "a1" });
    const call = calls.find((c) => c.resource === "voicemails")!;
    expect(call.query).toEqual({ agent_id: "a1" });
  });

  it("sends agent_id/project_id/enabled to /v1/schedules (filters not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listSchedules({ agent_id: "a1", project_id: "p1", enabled: true });
    const call = calls.find((c) => c.resource === "schedules")!;
    // listAll drops undefined keys; enabled must be present as "true".
    expect(call.query).toMatchObject({ agent_id: "a1", project_id: "p1", enabled: "true" });
  });

  it("forwards project_id to /v1/agents when listing (filter not dropped)", async () => {
    const { client, calls } = captureClient();
    const store = new ApiStore(client as never);
    await store.listAgents("p1");
    const call = calls.find((c) => c.resource === "agents")!;
    expect(call.query).toEqual({ project_id: "p1" });
  });
});

describe("ApiStore Twilio passthrough routes through the server /v1 proxy", () => {
  // Capture transport.get() calls — the escape hatch ApiStore uses for the
  // non-CRUD Twilio-proxy routes. The client must NEVER call Twilio directly.
  function captureTransport(items: unknown[]) {
    const calls: { path: string; query?: Record<string, unknown> }[] = [];
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.hasna.xyz/v1",
      transport: {
        baseUrl: "https://telephony.hasna.xyz/v1",
        async get(path: string, opts?: { query?: Record<string, unknown> }) {
          calls.push({ path, query: opts?.query });
          return { items, total: items.length };
        },
        async request() { return {} as never; },
        async post() { return {} as never; },
        async put() { return {} as never; },
        async patch() { return {} as never; },
        async del() { return {} as never; },
      },
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() { return {} as never; },
      async update() { return {} as never; },
      async delete() {},
    };
    return { client, calls };
  }

  it("searchAvailableNumbers → GET /numbers/available with mapped query", async () => {
    const sample = [{ phoneNumber: "+15005550006", friendlyName: "(500) 555-0006", locality: "X", region: "CA", capabilities: { voice: true, sms: true, mms: false } }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.searchAvailableNumbers({ country: "US", area_code: "415", limit: 5, sms_enabled: true });
    expect(calls[0]!.path).toBe("/numbers/available");
    expect(calls[0]!.query).toEqual({ country: "US", area_code: "415", sms_enabled: "true", limit: 5 });
    expect(res).toEqual(sample);
  });

  it("listTwilioNumbers → GET /numbers/twilio", async () => {
    const sample = [{ sid: "PNxxx", phoneNumber: "+15005550006", friendlyName: "main" }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.listTwilioNumbers();
    expect(calls[0]!.path).toBe("/numbers/twilio");
    expect(res).toEqual(sample);
  });

  it("listVoices → GET /voices (client never calls ElevenLabs directly / needs no local key)", async () => {
    const sample = [{ voice_id: "v1", name: "Rachel", category: "premade", description: "" }];
    const { client, calls } = captureTransport(sample);
    const store = new ApiStore(client as never);
    const res = await store.listVoices();
    expect(calls[0]!.path).toBe("/voices");
    expect(res).toEqual(sample);
  });
});

describe("ApiStore.registerAgent (parity with LocalStore conflict semantics)", () => {
  const existing: Agent = {
    id: "ag-1",
    name: "brutus",
    description: null,
    session_id: "sess-A",
    project_id: null,
    capabilities: [],
    permissions: ["*"],
    status: "active",
    metadata: {},
    last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it("maps a 409 from the serve route to an AgentConflictError value (not a throw)", async () => {
    const conflict: AgentConflictError = {
      error: "conflict",
      message: `Agent name "brutus" is currently held by an active session`,
      existing_agent: existing,
    };
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.hasna.xyz/v1",
      transport: {} as never,
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() {
        throw new HasnaHttpError("POST", "/agents", 409, conflict);
      },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    const result = await store.registerAgent({ name: "Brutus", session_id: "sess-B" });
    expect("error" in result && result.error).toBe("conflict");
    expect((result as AgentConflictError).existing_agent.id).toBe("ag-1");
  });

  it("re-throws non-409 HTTP errors (does not swallow real failures)", async () => {
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.hasna.xyz/v1",
      transport: {} as never,
      async list() { return { items: [], total: 0, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() {
        throw new HasnaHttpError("POST", "/agents", 500, { error: "internal" });
      },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    await expect(store.registerAgent({ name: "Brutus" })).rejects.toThrow();
  });

  it("matches agents by name case-insensitively (getAgentByName parity)", async () => {
    const client = {
      name: "telephony",
      baseUrl: "https://telephony.hasna.xyz/v1",
      transport: {} as never,
      async list() { return { items: [existing], total: 1, cursor: null, raw: {} }; },
      async get() { return null; },
      async create() { return {} as never; },
      async update() { return {} as never; },
      async delete() {},
    };
    const store = new ApiStore(client as never);
    const found = await store.getAgentByName("BRUTUS");
    expect(found?.id).toBe("ag-1");
  });
});
