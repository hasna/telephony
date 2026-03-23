import { SqliteAdapter as Database } from "@hasna/cloud";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".telephony", "telephony.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  if (process.env["HASNA_TELEPHONY_DB_PATH"]) {
    return process.env["HASNA_TELEPHONY_DB_PATH"];
  }
  if (process.env["TELEPHONY_DB_PATH"]) {
    return process.env["TELEPHONY_DB_PATH"];
  }

  const cwd = process.cwd();
  const nearest = findNearestDb(cwd);
  if (nearest) return nearest;

  if (process.env["TELEPHONY_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return join(gitRoot, ".telephony", "telephony.db");
    }
  }

  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newPath = join(home, ".hasna", "telephony", "telephony.db");
  const legacyPath = join(home, ".telephony", "telephony.db");

  if (!existsSync(newPath) && existsSync(legacyPath)) {
    return legacyPath;
  }

  return newPath;
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  // Migration 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    session_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    capabilities TEXT DEFAULT '[]',
    permissions TEXT DEFAULT '["*"]',
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'archived')),
    metadata TEXT DEFAULT '{}',
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    working_dir TEXT,
    metadata TEXT DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS phone_numbers (
    id TEXT PRIMARY KEY,
    number TEXT UNIQUE NOT NULL,
    country TEXT NOT NULL DEFAULT 'US',
    capabilities TEXT DEFAULT '["sms","voice"]',
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    twilio_sid TEXT,
    friendly_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending', 'released')),
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('sms_outbound', 'sms_inbound', 'whatsapp_outbound', 'whatsapp_inbound')),
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT,
    media_url TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'delivered', 'failed', 'received', 'read')),
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    twilio_sid TEXT,
    error_message TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'failed', 'canceled')),
    duration INTEGER,
    recording_url TEXT,
    transcription TEXT,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    twilio_sid TEXT,
    metadata TEXT DEFAULT '{}',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS voicemails (
    id TEXT PRIMARY KEY,
    call_id TEXT REFERENCES calls(id) ON DELETE SET NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    recording_url TEXT,
    local_path TEXT,
    transcription TEXT,
    duration INTEGER,
    listened INTEGER NOT NULL DEFAULT 0,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    notes TEXT,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'custom' CHECK(action IN ('send_sms', 'send_whatsapp', 'make_call', 'tts', 'custom')),
    command TEXT NOT NULL,
    parameters TEXT DEFAULT '{}',
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run TEXT,
    next_run TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    secret TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    webhook_id TEXT REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
    response_code INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id);
  CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
  CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_number);
  CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_number);
  CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
  CREATE INDEX IF NOT EXISTS idx_calls_agent ON calls(agent_id);
  CREATE INDEX IF NOT EXISTS idx_calls_project ON calls(project_id);
  CREATE INDEX IF NOT EXISTS idx_phone_numbers_agent ON phone_numbers(agent_id);
  CREATE INDEX IF NOT EXISTS idx_phone_numbers_project ON phone_numbers(project_id);
  CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
  CREATE INDEX IF NOT EXISTS idx_agents_project ON agents(project_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_agent ON contacts(agent_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
  CREATE INDEX IF NOT EXISTS idx_schedules_agent ON schedules(agent_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);
  CREATE INDEX IF NOT EXISTS idx_voicemails_agent ON voicemails(agent_id);
  `,

  // Migration 2: Feedback table
  `
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  // Migration 3: FTS5 for message search
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    body,
    content='messages',
    content_rowid='rowid'
  );

  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
  END;

  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.body);
    INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
  END;
  `,
];

// ---------------------------------------------------------------------------
// Database singleton
// ---------------------------------------------------------------------------

let _db: Database | null = null;
let _dbPath: string | null = null;

export function getDatabase(path?: string): Database {
  const targetPath = path || getDbPath();
  if (_db && _dbPath === targetPath) return _db;

  ensureDir(targetPath);
  const db = new Database(targetPath);

  // Run migrations
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM _migrations").all() as { version: number }[]).map(r => r.version),
  );

  for (let i = 0; i < MIGRATIONS.length; i++) {
    if (!applied.has(i + 1)) {
      db.exec(MIGRATIONS[i]!);
      db.run("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)", [i + 1, now()]);
    }
  }

  _db = db;
  _dbPath = targetPath;
  return db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

export function resetDatabase(): void {
  closeDatabase();
}

export function resolvePartialId(table: string, partial: string, db?: Database): string | null {
  const d = db || getDatabase();
  const rows = d.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partial}%`) as { id: string }[];
  if (rows.length === 1) return rows[0]!.id;
  return null;
}
