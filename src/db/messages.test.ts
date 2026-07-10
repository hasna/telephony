import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase } from "./database.js";
import { createMessage, searchMessages } from "./messages.js";

// Regression coverage for the FTS5 special-character crash: a query containing
// an FTS operator char (e.g. the hyphen in "a-b") used to reach `MATCH` raw and
// throw a SQLiteError. searchMessages must now sanitize the query so any input
// is a safe MATCH string. Point the store at an isolated temp DB via the env
// path so the functions' bare getDatabase() calls resolve to it.

const originalDbPath = process.env.HASNA_TELEPHONY_DB_PATH;
let tempRoot: string | undefined;

beforeEach(() => {
  closeDatabase();
  tempRoot = mkdtempSync(join(tmpdir(), "telephony-msgs-"));
  process.env.HASNA_TELEPHONY_DB_PATH = join(tempRoot, "test.db");
});

afterEach(() => {
  closeDatabase();
  if (originalDbPath === undefined) delete process.env.HASNA_TELEPHONY_DB_PATH;
  else process.env.HASNA_TELEPHONY_DB_PATH = originalDbPath;
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("searchMessages", () => {
  it("does not throw on FTS5 special characters", () => {
    expect(() => searchMessages("a-b")).not.toThrow();
    expect(() => searchMessages("(foo)")).not.toThrow();
    expect(() => searchMessages("a AND b")).not.toThrow();
    expect(() => searchMessages("*")).not.toThrow();
  });

  it("returns [] for a query with no usable tokens", () => {
    expect(searchMessages("-")).toEqual([]);
    expect(searchMessages("   ")).toEqual([]);
  });

  it("still matches a hyphenated token literally", () => {
    createMessage({ type: "sms_outbound", from_number: "+15550001111", to_number: "+15550002222", body: "hello alpha-beta world" });
    const hits = searchMessages("alpha-beta");
    expect(hits.length).toBe(1);
    expect(hits[0]!.body).toContain("alpha-beta");
  });

  it("matches a plain token", () => {
    createMessage({ type: "sms_outbound", from_number: "+15550001111", to_number: "+15550002222", body: "quarterly report ready" });
    const hits = searchMessages("report");
    expect(hits.length).toBe(1);
  });
});
