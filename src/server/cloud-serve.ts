/**
 * @hasna/telephony — HTTP serve surface (telephony-serve).
 *
 * A real HTTP API wrapping the telephony core data model. PURE REMOTE per
 * Amendment A1: the service reads and writes the shared cloud Postgres directly
 * (no local cache, no sync engine in the service). Requests are authenticated
 * with @hasna/contracts API-key middleware.
 *
 * Public probes:
 *   GET  /health          liveness — { status, version, mode }
 *   GET  /ready           readiness — pings the DB
 *   GET  /version         { status, version, mode }
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)
 *
 * Versioned API (all require an API key; scopes telephony:read / telephony:write):
 *   /v1/contacts          CRUD (list/create/get/patch/delete)
 *   /v1/projects          list/create/get/delete
 *   /v1/agents            list/register
 *   /v1/numbers           list/get
 *   /v1/messages          list/get
 *   /v1/calls             list/get
 *   /v1/voicemails        list/get
 *   /v1/schedules         list/create/get
 *   /v1/webhooks          list/create/get
 */
import { readFileSync } from "node:fs";
import {
  verifyApiKey,
  ApiKeyStore,
  type ApiKeyVerifier,
  type ApiKeyPrincipal,
} from "@hasna/contracts/auth";
import { createTelephonyCloudClient } from "../db/remote-storage.js";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/index.js";

export const TELEPHONY_SERVE_APP = "telephony";

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

/**
 * Restore the vendored storage kit's intended `sslmode=require` semantics
 * (encrypt, do NOT verify — the fleet standard for in-VPC RDS) under
 * node-postgres >= 8.22, which otherwise reinterprets a bare `sslmode=require`
 * as `verify-full`. Never logs the URL. Returns the (possibly) updated value.
 */
export function normalizeCloudDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = "HASNA_TELEPHONY_DATABASE_URL";
  const url = env[key] ?? env.TELEPHONY_DATABASE_URL;
  if (!url) return url;
  const lower = url.toLowerCase();
  const needsCompat =
    (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) &&
    !lower.includes("uselibpqcompat");
  if (!needsCompat) return url;
  const updated = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}

function resolveVersion(): string {
  if (process.env.HASNA_TELEPHONY_VERSION) return process.env.HASNA_TELEPHONY_VERSION;
  try {
    const url = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}

function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_TELEPHONY_API_SIGNING_KEY ?? env.API_KEY_SIGNING_SECRET ?? env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error(
      "telephony-serve requires an API signing secret: set HASNA_TELEPHONY_API_SIGNING_KEY " +
        "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Row mappers (JSON columns are TEXT; timestamps come back as Date via pg)
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function iso(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
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

function uuid(): string {
  return crypto.randomUUID();
}

function requireString(body: Record<string, unknown>, field: string): string {
  const v = body[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new HttpError(400, `${field} is required`);
  }
  return v;
}

function clampLimit(raw: string | null, def = 50, max = 200): number {
  const n = raw == null ? def : Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

// ---------------------------------------------------------------------------
// Repositories — cloud Postgres (PURE REMOTE / A1)
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: unknown;
}

function mapContact(r: Row) {
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

function mapProject(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    path: String(r.path ?? ""),
    description: (r.description as string | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

function mapAgent(r: Row) {
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

function mapNumber(r: Row) {
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

function mapMessage(r: Row) {
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

function mapCall(r: Row) {
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

function mapVoicemail(r: Row) {
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

function mapSchedule(r: Row) {
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

function mapWebhook(r: Row) {
  return {
    id: String(r.id),
    url: String(r.url ?? ""),
    events: parseJson<string[]>(r.events, []),
    secret: (r.secret as string | null) ?? null,
    active: Boolean(r.active),
    created_at: iso(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

export interface ServeDeps {
  client: PoolQueryClient;
  verifier: ApiKeyVerifier;
  store: ApiKeyStore;
  version: string;
}

export function createServeHandler(deps: ServeDeps): (req: Request) => Promise<Response> {
  const db: TypedQueryClient = deps.client;
  const mode = "cloud";

  const authOrThrow = async (req: Request, requiredScopes: string[]): Promise<ApiKeyPrincipal> => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes,
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    void deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };

  const readBody = async (req: Request): Promise<Record<string, unknown>> => {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "invalid JSON request body");
    });
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "JSON request body must be an object");
    }
    return body as Record<string, unknown>;
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type, authorization, x-api-key",
        },
      });
    }

    try {
      // ---- Public probes ----
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/ready" && method === "GET") {
        try {
          await db.query("SELECT 1");
          return json({ status: "ready", version: deps.version, mode });
        } catch {
          return json({ status: "unavailable", version: deps.version, mode }, 503);
        }
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(telephonyOpenApi(deps.version));
      }

      // ---- /v1/contacts (full CRUD) ----
      if (path === "/v1/contacts") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const limit = clampLimit(url.searchParams.get("limit"));
          const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
          const search = url.searchParams.get("search");
          const params: unknown[] = [];
          let where = "";
          if (search) {
            params.push(`%${search}%`);
            where = `WHERE (name ILIKE $1 OR phone ILIKE $1 OR email ILIKE $1)`;
          }
          const total = await db.get<{ count: string }>(
            `SELECT count(*)::text AS count FROM contacts ${where}`,
            params,
          );
          const rows = await db.many<Row>(
            `SELECT * FROM contacts ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            params,
          );
          return json({ items: rows.map(mapContact), total: Number(total?.count ?? 0) });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const phone = requireString(body, "phone");
          const id = uuid();
          const row = await db.get<Row>(
            `INSERT INTO contacts (id, name, phone, email, agent_id, project_id, notes, tags, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [
              id,
              name,
              phone,
              (body.email as string) ?? null,
              (body.agent_id as string) ?? null,
              (body.project_id as string) ?? null,
              (body.notes as string) ?? null,
              JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
              JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
            ],
          );
          return json(mapContact(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      const contactMatch = path.match(/^\/v1\/contacts\/([^/]+)$/);
      if (contactMatch) {
        const id = decodeURIComponent(contactMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM contacts WHERE id = $1`, [id]);
          return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const sets: string[] = [];
          const params: unknown[] = [];
          const push = (col: string, val: unknown) => {
            params.push(val);
            sets.push(`${col} = $${params.length}`);
          };
          if (typeof body.name === "string") push("name", body.name);
          if (typeof body.phone === "string") push("phone", body.phone);
          if (body.email !== undefined) push("email", (body.email as string) ?? null);
          if (body.notes !== undefined) push("notes", (body.notes as string) ?? null);
          if (body.tags !== undefined) push("tags", JSON.stringify(Array.isArray(body.tags) ? body.tags : []));
          if (body.metadata !== undefined)
            push("metadata", JSON.stringify((body.metadata as Record<string, unknown>) ?? {}));
          if (sets.length === 0) {
            const row = await db.get<Row>(`SELECT * FROM contacts WHERE id = $1`, [id]);
            return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
          }
          sets.push(`updated_at = NOW()`);
          params.push(id);
          const row = await db.get<Row>(
            `UPDATE contacts SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
            params,
          );
          return row ? json(mapContact(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM contacts WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- /v1/projects ----
      if (path === "/v1/projects") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(`SELECT * FROM projects ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapProject), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const p = requireString(body, "path");
          const row = await db.get<Row>(
            `INSERT INTO projects (id, name, path, description) VALUES ($1,$2,$3,$4)
             ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW() RETURNING *`,
            [uuid(), name, p, (body.description as string) ?? null],
          );
          return json(mapProject(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const projectMatch = path.match(/^\/v1\/projects\/([^/]+)$/);
      if (projectMatch) {
        const id = decodeURIComponent(projectMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM projects WHERE id = $1`, [id]);
          return row ? json(mapProject(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM projects WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- /v1/agents ----
      if (path === "/v1/agents") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(
            `SELECT * FROM agents WHERE status != 'archived' ORDER BY last_seen_at DESC LIMIT 200`,
          );
          return json({ items: rows.map(mapAgent), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const row = await db.get<Row>(
            `INSERT INTO agents (id, name, description, session_id, project_id, capabilities, permissions)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [
              uuid(),
              name,
              (body.description as string) ?? null,
              (body.session_id as string) ?? null,
              (body.project_id as string) ?? null,
              JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : []),
              JSON.stringify(Array.isArray(body.permissions) ? body.permissions : ["*"]),
            ],
          );
          return json(mapAgent(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- read-only collections ----
      const listOnly: Record<string, { table: string; order: string; map: (r: Row) => unknown }> = {
        "/v1/numbers": { table: "phone_numbers", order: "created_at DESC", map: mapNumber },
        "/v1/messages": { table: "messages", order: "created_at DESC", map: mapMessage },
        "/v1/calls": { table: "calls", order: "started_at DESC", map: mapCall },
        "/v1/voicemails": { table: "voicemails", order: "created_at DESC", map: mapVoicemail },
      };
      if (listOnly[path] && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = listOnly[path]!;
        const limit = clampLimit(url.searchParams.get("limit"));
        const rows = await db.many<Row>(
          `SELECT * FROM ${spec.table} ORDER BY ${spec.order} LIMIT ${limit}`,
        );
        return json({ items: rows.map(spec.map), total: rows.length });
      }
      const singleGet: Record<string, { table: string; map: (r: Row) => unknown }> = {
        numbers: { table: "phone_numbers", map: mapNumber },
        messages: { table: "messages", map: mapMessage },
        calls: { table: "calls", map: mapCall },
        voicemails: { table: "voicemails", map: mapVoicemail },
      };
      const singleMatch = path.match(/^\/v1\/(numbers|messages|calls|voicemails)\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = singleGet[singleMatch[1]!]!;
        const row = await db.get<Row>(`SELECT * FROM ${spec.table} WHERE id = $1`, [
          decodeURIComponent(singleMatch[2]!),
        ]);
        return row ? json(spec.map(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/schedules ----
      if (path === "/v1/schedules") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(`SELECT * FROM schedules ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapSchedule), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const name = requireString(body, "name");
          const cron = requireString(body, "cron_expression");
          const command = requireString(body, "command");
          const action = typeof body.action === "string" ? body.action : "custom";
          const row = await db.get<Row>(
            `INSERT INTO schedules (id, name, cron_expression, action, command, parameters, agent_id, project_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              uuid(),
              name,
              cron,
              action,
              command,
              JSON.stringify((body.parameters as Record<string, unknown>) ?? {}),
              (body.agent_id as string) ?? null,
              (body.project_id as string) ?? null,
            ],
          );
          return json(mapSchedule(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const scheduleMatch = path.match(/^\/v1\/schedules\/([^/]+)$/);
      if (scheduleMatch && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const row = await db.get<Row>(`SELECT * FROM schedules WHERE id = $1`, [
          decodeURIComponent(scheduleMatch[1]!),
        ]);
        return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/webhooks ----
      if (path === "/v1/webhooks") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const rows = await db.many<Row>(`SELECT * FROM webhooks ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapWebhook), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const u = requireString(body, "url");
          const row = await db.get<Row>(
            `INSERT INTO webhooks (id, url, events, secret) VALUES ($1,$2,$3,$4) RETURNING *`,
            [
              uuid(),
              u,
              JSON.stringify(Array.isArray(body.events) ? body.events : []),
              (body.secret as string) ?? null,
            ],
          );
          return json(mapWebhook(row!), 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const webhookMatch = path.match(/^\/v1\/webhooks\/([^/]+)$/);
      if (webhookMatch && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const row = await db.get<Row>(`SELECT * FROM webhooks WHERE id = $1`, [
          decodeURIComponent(webhookMatch[1]!),
        ]);
        return row ? json(mapWebhook(row)) : json({ error: "not_found" }, 404);
      }

      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// OpenAPI document — source of truth for the generated SDK.
// ---------------------------------------------------------------------------

export function telephonyOpenApi(version: string): Record<string, unknown> {
  const listResponse = (ref: string) => ({
    type: "object",
    properties: {
      items: { type: "array", items: { $ref: `#/components/schemas/${ref}` } },
      total: { type: "integer" },
    },
    required: ["items", "total"],
  });
  const contact = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      phone: { type: "string" },
      email: { type: "string", nullable: true },
      agent_id: { type: "string", nullable: true },
      project_id: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["id", "name", "phone", "tags", "metadata", "created_at", "updated_at"],
  };
  const str = { type: "string" };
  const strN = { type: "string", nullable: true };
  const intN = { type: "integer", nullable: true };
  const obj = { type: "object", additionalProperties: true };
  const project = {
    type: "object",
    properties: {
      id: str,
      name: str,
      path: str,
      description: strN,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "path", "created_at", "updated_at"],
  };
  const agent = {
    type: "object",
    properties: {
      id: str,
      name: str,
      description: strN,
      session_id: strN,
      project_id: strN,
      capabilities: { type: "array", items: str },
      permissions: { type: "array", items: str },
      status: str,
      metadata: obj,
      last_seen_at: str,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "status", "created_at", "updated_at"],
  };
  const schedule = {
    type: "object",
    properties: {
      id: str,
      name: str,
      cron_expression: str,
      action: str,
      command: str,
      parameters: obj,
      agent_id: strN,
      project_id: strN,
      enabled: { type: "boolean" },
      last_run: strN,
      next_run: strN,
      run_count: { type: "integer" },
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "name", "cron_expression", "action", "command", "created_at", "updated_at"],
  };
  const webhook = {
    type: "object",
    properties: {
      id: str,
      url: str,
      events: { type: "array", items: str },
      secret: strN,
      active: { type: "boolean" },
      created_at: str,
    },
    required: ["id", "url", "events", "active", "created_at"],
  };
  const phoneNumber = {
    type: "object",
    properties: {
      id: str,
      number: str,
      country: str,
      capabilities: { type: "array", items: str },
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      friendly_name: strN,
      status: str,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "number", "status", "created_at", "updated_at"],
  };
  const message = {
    type: "object",
    properties: {
      id: str,
      type: str,
      from_number: str,
      to_number: str,
      body: strN,
      media_url: strN,
      status: str,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      error_message: strN,
      metadata: obj,
      created_at: str,
      updated_at: str,
    },
    required: ["id", "type", "from_number", "to_number", "status", "created_at", "updated_at"],
  };
  const call = {
    type: "object",
    properties: {
      id: str,
      direction: str,
      from_number: str,
      to_number: str,
      status: str,
      duration: intN,
      recording_url: strN,
      transcription: strN,
      agent_id: strN,
      project_id: strN,
      twilio_sid: strN,
      metadata: obj,
      started_at: str,
      ended_at: strN,
      created_at: str,
    },
    required: ["id", "direction", "from_number", "to_number", "status", "started_at", "created_at"],
  };
  const voicemail = {
    type: "object",
    properties: {
      id: str,
      call_id: strN,
      from_number: str,
      to_number: str,
      recording_url: strN,
      local_path: strN,
      transcription: strN,
      duration: intN,
      listened: { type: "boolean" },
      agent_id: strN,
      project_id: strN,
      created_at: str,
    },
    required: ["id", "from_number", "to_number", "listened", "created_at"],
  };
  return {
    openapi: "3.0.3",
    info: { title: "Telephony", version, description: "@hasna/telephony self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Contact: contact,
        ContactInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            agent_id: { type: "string", nullable: true },
            project_id: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["name", "phone"],
        },
        ContactPatch: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            email: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            tags: { type: "array", items: { type: "string" } },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        ContactList: listResponse("Contact"),
        Project: project,
        ProjectInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            description: { type: "string", nullable: true },
          },
          required: ["name", "path"],
        },
        ProjectList: listResponse("Project"),
        Agent: agent,
        AgentInput: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        AgentList: listResponse("Agent"),
        Schedule: schedule,
        ScheduleInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            cron_expression: { type: "string" },
            command: { type: "string" },
            action: { type: "string" },
            parameters: { type: "object", additionalProperties: true },
          },
          required: ["name", "cron_expression", "command"],
        },
        ScheduleList: listResponse("Schedule"),
        Webhook: webhook,
        WebhookInput: {
          type: "object",
          properties: {
            url: { type: "string" },
            events: { type: "array", items: { type: "string" } },
            secret: { type: "string", nullable: true },
          },
          required: ["url"],
        },
        WebhookList: listResponse("Webhook"),
        PhoneNumber: phoneNumber,
        PhoneNumberList: listResponse("PhoneNumber"),
        Message: message,
        MessageList: listResponse("Message"),
        Call: call,
        CallList: listResponse("Call"),
        Voicemail: voicemail,
        VoicemailList: listResponse("Voicemail"),
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/contacts": {
        get: {
          operationId: "listContacts",
          summary: "List contacts",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ContactList" } } } },
          },
        },
        post: {
          operationId: "createContact",
          summary: "Create a contact",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
      },
      "/v1/contacts/{id}": {
        get: {
          operationId: "getContact",
          summary: "Fetch a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        patch: {
          operationId: "updateContact",
          summary: "Update a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ContactPatch" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
          },
        },
        delete: {
          operationId: "deleteContact",
          summary: "Delete a contact",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/projects": {
        get: {
          operationId: "listProjects",
          summary: "List projects",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectList" } } } },
          },
        },
        post: {
          operationId: "createProject",
          summary: "Create a project",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ProjectInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
      },
      "/v1/projects/{id}": {
        get: {
          operationId: "getProject",
          summary: "Fetch a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          },
        },
        delete: {
          operationId: "deleteProject",
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} },
        },
      },
      "/v1/agents": {
        get: {
          operationId: "listAgents",
          summary: "List agents",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/AgentList" } } } },
          },
        },
        post: {
          operationId: "registerAgent",
          summary: "Register an agent",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AgentInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } },
          },
        },
      },
      "/v1/numbers": {
        get: {
          operationId: "listNumbers",
          summary: "List phone numbers",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/PhoneNumberList" } } } },
          },
        },
      },
      "/v1/messages": {
        get: {
          operationId: "listMessages",
          summary: "List messages",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/MessageList" } } } },
          },
        },
      },
      "/v1/calls": {
        get: {
          operationId: "listCalls",
          summary: "List calls",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/CallList" } } } },
          },
        },
      },
      "/v1/voicemails": {
        get: {
          operationId: "listVoicemails",
          summary: "List voicemails",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/VoicemailList" } } } },
          },
        },
      },
      "/v1/schedules": {
        get: {
          operationId: "listSchedules",
          summary: "List schedules",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleList" } } } },
          },
        },
        post: {
          operationId: "createSchedule",
          summary: "Create a schedule",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ScheduleInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Schedule" } } } },
          },
        },
      },
      "/v1/webhooks": {
        get: {
          operationId: "listWebhooks",
          summary: "List webhooks",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookList" } } } },
          },
        },
        post: {
          operationId: "createWebhook",
          summary: "Create a webhook",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Webhook" } } } },
          },
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

export interface StartServeOptions {
  port?: number;
  hostname?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunningServe {
  port: number;
  hostname: string;
  stop: () => Promise<void>;
}

/**
 * Start the telephony HTTP service on Bun. Opens a PURE-REMOTE cloud pool and a
 * contracts API-key verifier backed by the api_keys table (revocation).
 */
export async function startTelephonyServe(options: StartServeOptions = {}): Promise<RunningServe> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_TELEPHONY_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = resolveVersion();

  normalizeCloudDatabaseUrl(env);
  const client = createTelephonyCloudClient();
  const store = new ApiKeyStore(client);
  // DDL (the api_keys table) is owned by the migration task (run as the DB
  // owner role); the service connects with a DML-only app role, so it must NOT
  // attempt CREATE TABLE here. The api_keys schema is a deploy prerequisite
  // (bun scripts/apply-cloud-migrations.mjs).
  const verifier = verifyApiKey({
    app: TELEPHONY_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        // Never log tokens/keys — kid + reason only.
        console.warn(
          `[telephony-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`,
        );
      }
    },
  });

  const handler = createServeHandler({ client, verifier, store, version });

  const BunGlobal = (
    globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } }
  ).Bun;
  if (!BunGlobal?.serve) {
    throw new Error("telephony-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(
    `[telephony-serve] listening on http://${hostname}:${server.port} (mode=cloud, version=${version})`,
  );

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    },
  };
}
