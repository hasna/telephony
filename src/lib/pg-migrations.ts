/**
 * PostgreSQL migrations for open-telephony cloud sync.
 */
export const PG_MIGRATIONS: string[] = [
  // Migration 1: Full schema
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    session_id TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    capabilities TEXT DEFAULT '[]',
    permissions TEXT DEFAULT '["*"]',
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    working_dir TEXT,
    metadata TEXT DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    status TEXT NOT NULL DEFAULT 'active',
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT,
    media_url TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    twilio_sid TEXT,
    error_message TEXT,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL,
    from_number TEXT NOT NULL,
    to_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'initiated',
    duration INTEGER,
    recording_url TEXT,
    transcription TEXT,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    twilio_sid TEXT,
    metadata TEXT DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    listened BOOLEAN NOT NULL DEFAULT FALSE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'custom',
    command TEXT NOT NULL,
    parameters TEXT DEFAULT '{}',
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ,
    run_count INTEGER NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    secret TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    webhook_id TEXT REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    response_code INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    message TEXT NOT NULL,
    email TEXT,
    category TEXT DEFAULT 'general',
    version TEXT,
    machine_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  INSERT INTO _migrations (id) VALUES (1) ON CONFLICT DO NOTHING;
  `,
];
