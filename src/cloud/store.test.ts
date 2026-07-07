import { afterEach, describe, expect, it } from "bun:test";
import { isCloud, resetTelephonyStore, resolveTelephonyStore } from "./store.js";

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
  resetTelephonyStore();
}

afterEach(clearEnv);

describe("telephony client storage resolver", () => {
  it("defaults to the local store when nothing is set", () => {
    clearEnv();
    const r = resolveTelephonyStore();
    expect(r.transport).toBe("local");
    expect(r.client).toBeNull();
    expect(isCloud()).toBe(false);
  });

  it("stays local in self_hosted mode without an API key (no silent drift)", () => {
    clearEnv();
    process.env.HASNA_TELEPHONY_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TELEPHONY_API_URL = "https://telephony.hasna.xyz";
    // resolveStorageClient throws when cloud is requested but misconfigured.
    expect(() => resolveTelephonyStore()).toThrow();
  });

  it("routes to the cloud /v1 API in self_hosted mode with URL + key", () => {
    clearEnv();
    process.env.HASNA_TELEPHONY_STORAGE_MODE = "self_hosted";
    process.env.HASNA_TELEPHONY_API_URL = "https://telephony.hasna.xyz";
    process.env.HASNA_TELEPHONY_API_KEY = "hasna_telephony_test_key";
    const r = resolveTelephonyStore();
    expect(r.transport).toBe("cloud-http");
    expect(isCloud()).toBe(true);
    if (r.transport === "cloud-http") {
      expect(r.client.baseUrl).toBe("https://telephony.hasna.xyz/v1");
      expect(r.client.name).toBe("telephony");
    }
  });

  it("accepts the canonical cloud alias too", () => {
    clearEnv();
    process.env.HASNA_TELEPHONY_STORAGE_MODE = "cloud";
    process.env.HASNA_TELEPHONY_API_URL = "https://telephony.hasna.xyz";
    process.env.HASNA_TELEPHONY_API_KEY = "hasna_telephony_test_key";
    expect(resolveTelephonyStore().transport).toBe("cloud-http");
  });
});
