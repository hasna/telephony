import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath, getDatabase, closeDatabase } from "./database.js";
import { SqliteAdapter } from "./sqlite-adapter.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHasnaDbPath = process.env.HASNA_TELEPHONY_DB_PATH;
const originalTelephonyDbPath = process.env.TELEPHONY_DB_PATH;
const originalScope = process.env.TELEPHONY_DB_SCOPE;
const originalCwd = process.cwd();

let tempRoot: string | undefined;

afterEach(() => {
  closeDatabase();

  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHasnaDbPath === undefined) delete process.env.HASNA_TELEPHONY_DB_PATH;
  else process.env.HASNA_TELEPHONY_DB_PATH = originalHasnaDbPath;
  if (originalTelephonyDbPath === undefined) delete process.env.TELEPHONY_DB_PATH;
  else process.env.TELEPHONY_DB_PATH = originalTelephonyDbPath;
  if (originalScope === undefined) delete process.env.TELEPHONY_DB_SCOPE;
  else process.env.TELEPHONY_DB_SCOPE = originalScope;
  process.chdir(originalCwd);

  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("getDbPath", () => {
  it("copies legacy home ~/.telephony state into ~/.hasna/telephony", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-db-test-"));
    const home = join(tempRoot, "home");
    const cwd = join(tempRoot, "cwd");
    const legacyDir = join(home, ".telephony");
    const newDir = join(home, ".hasna", "telephony");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(legacyDir, "telephony.db"), "legacy-db");
    writeFileSync(join(legacyDir, "config.json"), "{\"voice\":\"on\"}");

    process.env.HOME = home;
    delete process.env.USERPROFILE;
    delete process.env.HASNA_TELEPHONY_DB_PATH;
    delete process.env.TELEPHONY_DB_PATH;
    delete process.env.TELEPHONY_DB_SCOPE;
    process.chdir(cwd);

    expect(getDbPath()).toBe(join(newDir, "telephony.db"));
    expect(readFileSync(join(newDir, "telephony.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("voice");
    expect(existsSync(join(legacyDir, "telephony.db"))).toBe(true);
  });
});

describe("getDatabase", () => {
  it("enforces app schema foreign-key delete behavior", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-db-test-"));
    const db = getDatabase(join(tempRoot, "telephony.db"));

    db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", ["project-1", "Project", tempRoot]);
    db.run("INSERT INTO agents (id, name, project_id) VALUES (?, ?, ?)", ["agent-1", "Agent", "project-1"]);
    db.run("DELETE FROM projects WHERE id = ?", ["project-1"]);

    expect(db.get("SELECT project_id FROM agents WHERE id = ?", ["agent-1"])).toEqual({ project_id: null });

    db.run("INSERT INTO webhooks (id, url) VALUES (?, ?)", ["webhook-1", "https://example.com/hook"]);
    db.run("INSERT INTO webhook_events (id, webhook_id, event) VALUES (?, ?, ?)", ["event-1", "webhook-1", "message.created"]);
    db.run("DELETE FROM webhooks WHERE id = ?", ["webhook-1"]);

    expect(db.get("SELECT id FROM webhook_events WHERE id = ?", ["event-1"])).toBeNull();
  });

  it("rebuilds message FTS entries for rows that existed before the FTS migration", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-db-test-"));
    const dbPath = join(tempRoot, "telephony.db");
    const seed = new SqliteAdapter(dbPath);

    seed.exec(`
      CREATE TABLE _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        from_number TEXT NOT NULL,
        to_number TEXT NOT NULL,
        body TEXT,
        media_url TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        agent_id TEXT,
        project_id TEXT,
        twilio_sid TEXT,
        error_message TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seed.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [1, new Date().toISOString()]);
    seed.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [2, new Date().toISOString()]);
    seed.run(
      "INSERT INTO messages (id, type, from_number, to_number, body, status) VALUES (?, ?, ?, ?, ?, ?)",
      ["msg-1", "sms_inbound", "+15550000001", "+15550000002", "existing searchable body", "received"],
    );
    seed.close();

    const db = getDatabase(dbPath);
    expect(db.get("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?", ["searchable"])).toEqual({ rowid: 1 });
  });

  it("closes the previous singleton when switching database paths", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-db-test-"));
    const first = getDatabase(join(tempRoot, "one.db"));
    const second = getDatabase(join(tempRoot, "two.db"));

    expect(second).not.toBe(first);
    expect(() => first.get("SELECT 1")).toThrow();
    expect(second.get("SELECT 1 AS ok")).toEqual({ ok: 1 });
  });
});
