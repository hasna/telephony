import { afterEach, describe, expect, it } from "bun:test";
import { getStore, isCloudStore, resetStore, ApiStore, LocalStore } from "./index.js";

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
});
