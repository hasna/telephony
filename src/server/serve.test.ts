import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ReturnType<typeof Bun.serve> | undefined;
let tempDir: string | undefined;

const originalDbPath = process.env.HASNA_TELEPHONY_DB_PATH;

afterEach(async () => {
  server?.stop(true);
  server = undefined;

  const { stopScheduler } = await import("../lib/scheduler.js");
  const { closeDatabase } = await import("../db/database.js");
  stopScheduler();
  closeDatabase();

  if (originalDbPath === undefined) delete process.env.HASNA_TELEPHONY_DB_PATH;
  else process.env.HASNA_TELEPHONY_DB_PATH = originalDbPath;

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("REST API request parsing", () => {
  it("returns 400 for malformed JSON request bodies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "telephony-server-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempDir, "telephony.db");

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\"url\":",
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Invalid JSON request body" });
  });

  it("matches JSON content types case-insensitively", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "telephony-server-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempDir, "telephony.db");

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "Application/Json" },
      body: "{\"url\":",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON request body" });
  });

  it("returns 400 for JSON bodies that are not objects", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "telephony-server-test-"));
    process.env.HASNA_TELEPHONY_DB_PATH = join(tempDir, "telephony.db");

    const { createServer } = await import("./serve.js");
    server = createServer(0);

    for (const body of ["[]", "null", "\"hello\"", "42", "true"]) {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "JSON request body must be an object" });
    }
  });
});
