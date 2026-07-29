/** Shared HTTP validation and database-row serialization for cloud routes. */
// ---------------------------------------------------------------------------
// Row mappers (JSON columns are TEXT; timestamps come back as Date via pg)
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function iso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }
  return v;
}

export function clampLimit(raw: string | null, def = 50, max = 200): number {
  const n = raw == null ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/**
 * The window after which an agent's held session is considered stale — matches
 * the local db/agents.ts default (30 min, overridable via
 * TELEPHONY_AGENT_TIMEOUT_MS) so registration takeover behaves identically in
 * local and cloud mode.
 */
export function agentActiveWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TELEPHONY_AGENT_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 30 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Repositories — cloud Postgres (PURE REMOTE / A1)
// ---------------------------------------------------------------------------

export interface Row {
  [key: string]: unknown;
}

export function mapContact(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: String(r.phone ?? ""),
    email: (r.email as string | null) ?? null,
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    tags: parseJson<string[]>(r.tags, []),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapProject(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    path: String(r.path ?? ""),
    description: (r.description as string | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapAgent(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: (r.description as string | null) ?? null,
    session_id: (r.session_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    capabilities: parseJson<string[]>(r.capabilities, []),
    permissions: parseJson<string[]>(r.permissions, ["*"]),
    status: String(r.status ?? "active"),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    last_seen_at: iso(r.last_seen_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapNumber(r: Row) {
  return {
    id: String(r.id),
    number: String(r.number ?? ""),
    country: String(r.country ?? "US"),
    capabilities: parseJson<string[]>(r.capabilities, []),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    friendly_name: (r.friendly_name as string | null) ?? null,
    status: String(r.status ?? "active"),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapMessage(r: Row) {
  return {
    id: String(r.id),
    type: String(r.type ?? ""),
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    body: (r.body as string | null) ?? null,
    media_url: (r.media_url as string | null) ?? null,
    status: String(r.status ?? ""),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    error_message: (r.error_message as string | null) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapCall(r: Row) {
  return {
    id: String(r.id),
    direction: String(r.direction ?? ""),
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    status: String(r.status ?? ""),
    duration: (r.duration as number | null) ?? null,
    recording_url: (r.recording_url as string | null) ?? null,
    transcription: (r.transcription as string | null) ?? null,
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    twilio_sid: (r.twilio_sid as string | null) ?? null,
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    started_at: iso(r.started_at),
    ended_at: isoOrNull(r.ended_at),
    created_at: iso(r.created_at),
  };
}

export function mapVoicemail(r: Row) {
  return {
    id: String(r.id),
    call_id: (r.call_id as string | null) ?? null,
    from_number: String(r.from_number ?? ""),
    to_number: String(r.to_number ?? ""),
    recording_url: (r.recording_url as string | null) ?? null,
    local_path: (r.local_path as string | null) ?? null,
    transcription: (r.transcription as string | null) ?? null,
    duration: (r.duration as number | null) ?? null,
    listened: Boolean(r.listened),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    created_at: iso(r.created_at),
  };
}

export function mapSchedule(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    cron_expression: String(r.cron_expression ?? ""),
    action: String(r.action ?? "custom"),
    command: String(r.command ?? ""),
    parameters: parseJson<Record<string, unknown>>(r.parameters, {}),
    agent_id: (r.agent_id as string | null) ?? null,
    project_id: (r.project_id as string | null) ?? null,
    enabled: Boolean(r.enabled),
    last_run: isoOrNull(r.last_run),
    next_run: isoOrNull(r.next_run),
    run_count: Number(r.run_count ?? 0),
    metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapWebhook(r: Row) {
  return {
    id: String(r.id),
    url: String(r.url ?? ""),
    events: parseJson<string[]>(r.events, []),
    secret_configured: Boolean(r.secret),
    active: Boolean(r.active),
    created_at: iso(r.created_at),
  };
}

export function mapWebhookDispatchTarget(r: Row) {
  return {
    ...mapWebhook(r),
    secret: (r.secret as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// JSON responses
// ---------------------------------------------------------------------------

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
