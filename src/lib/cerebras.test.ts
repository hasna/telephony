import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_CEREBRAS_MODEL, resolveModel } from "./cerebras.js";

const KEYS = ["CEREBRAS_MODEL", "HASNA_CEREBRAS_MODEL"] as const;

function clear() {
  for (const k of KEYS) delete process.env[k];
}

describe("resolveModel", () => {
  afterEach(clear);

  test("defaults to a served, generally-available Cerebras model (not the retired scout model)", () => {
    clear();
    expect(resolveModel()).toBe(DEFAULT_CEREBRAS_MODEL);
    // Guard against regressing to the retired model that 404'd every AI call.
    expect(resolveModel()).not.toBe("llama-4-scout-17b-16e-instruct");
  });

  test("CEREBRAS_MODEL overrides the default", () => {
    clear();
    process.env.CEREBRAS_MODEL = "zai-glm-4.7";
    expect(resolveModel()).toBe("zai-glm-4.7");
  });

  test("HASNA_CEREBRAS_MODEL is honored as a fallback key", () => {
    clear();
    process.env.HASNA_CEREBRAS_MODEL = "gemma-4-31b";
    expect(resolveModel()).toBe("gemma-4-31b");
  });

  test("strips a single pair of wrapping quotes", () => {
    clear();
    process.env.CEREBRAS_MODEL = '"gpt-oss-120b"';
    expect(resolveModel()).toBe("gpt-oss-120b");
  });

  test("blank/whitespace override falls back to the default", () => {
    clear();
    process.env.CEREBRAS_MODEL = "   ";
    expect(resolveModel()).toBe(DEFAULT_CEREBRAS_MODEL);
  });
});
