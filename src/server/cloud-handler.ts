import {
  ApiKeyStore,
  type ApiKeyPrincipal,
  type ApiKeyVerifier,
} from "@hasna/contracts/auth";
import type { PoolQueryClient, TypedQueryClient } from "../generated/storage-kit/index.js";
import { fetchVoicesFromProvider, hasElevenLabsConfig } from "../lib/tts.js";
import { getTwilioClient, hasTwilioConfig } from "../lib/twilio.js";
import {
  HttpError,
  agentActiveWindowMs,
  clampLimit,
  iso,
  json,
  mapAgent,
  mapCall,
  mapMessage,
  mapNumber,
  mapSchedule,
  mapVoicemail,
  mapWebhook,
  mapWebhookDispatchTarget,
  parseJson,
  requireString,
  uuid,
  type Row,
} from "./cloud-api-support.js";
import { handleDirectoryRoutes } from "./cloud-directory-routes.js";
import { telephonyOpenApi } from "./cloud-openapi.js";

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

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

      const directoryResponse = await handleDirectoryRoutes({
        db,
        req,
        url,
        path,
        method,
        authOrThrow,
        readBody,
      });
      if (directoryResponse) return directoryResponse;

      // ---- /v1/agents ----
      if (path === "/v1/agents") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          // Parity with LocalStore.listAgents: agent_id/project_id are exact
          // scoping filters served DB-side (they were silently dropped before,
          // so `--project X` returned every agent in cloud mode).
          const where: string[] = [`status != 'archived'`];
          const params: unknown[] = [];
          for (const col of ["agent_id", "project_id"]) {
            const val = url.searchParams.get(col);
            if (val != null && val !== "") {
              params.push(val);
              // agent_id maps to the primary key `id`.
              where.push(`${col === "agent_id" ? "id" : col} = $${params.length}`);
            }
          }
          const rows = await db.many<Row>(
            `SELECT * FROM agents WHERE ${where.join(" AND ")} ORDER BY last_seen_at DESC LIMIT 200`,
            params,
          );
          return json({ items: rows.map(mapAgent), total: rows.length });
        }
        if (method === "POST") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          // Parity with LocalStore.registerAgent (db/agents.ts): normalize the
          // name (trim + lowercase), then enforce active-session conflict /
          // force-takeover semantics. Previously the cloud route did a blind
          // INSERT — no normalization, no conflict detection — so the same name
          // could be registered by two live sessions (split-brain identity).
          const name = requireString(body, "name").trim().toLowerCase();
          const sessionId = (body.session_id as string) ?? null;
          const force = body.force === true;
          const existing = await db.get<Row>(`SELECT * FROM agents WHERE LOWER(name) = $1`, [name]);
          if (existing) {
            const existingSession = (existing.session_id as string | null) ?? null;
            // Same session re-registering: refresh liveness, return existing.
            if (sessionId && existingSession === sessionId) {
              const row = await db.get<Row>(
                `UPDATE agents SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
                [existing.id],
              );
              return json(mapAgent(row!), 200);
            }
            const lastSeenMs = Date.parse(iso(existing.last_seen_at));
            const isStale = !Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > agentActiveWindowMs();
            // Held by a live session and not forced: conflict (never overwrite).
            if (!isStale && !force && existingSession) {
              return json(
                {
                  error: "conflict",
                  message: `Agent name "${name}" is currently held by an active session`,
                  existing_agent: mapAgent(existing),
                },
                409,
              );
            }
            // Takeover (stale session or --force).
            const row = await db.get<Row>(
              `UPDATE agents SET session_id = $1, description = COALESCE($2, description),
                 project_id = COALESCE($3, project_id), capabilities = $4, permissions = $5,
                 status = 'active', metadata = '{}', last_seen_at = NOW(), updated_at = NOW()
               WHERE id = $6 RETURNING *`,
              [
                sessionId,
                (body.description as string) ?? null,
                (body.project_id as string) ?? null,
                JSON.stringify(
                  Array.isArray(body.capabilities)
                    ? body.capabilities
                    : parseJson<string[]>(existing.capabilities, []),
                ),
                JSON.stringify(
                  Array.isArray(body.permissions)
                    ? body.permissions
                    : parseJson<string[]>(existing.permissions, ["*"]),
                ),
                existing.id,
              ],
            );
            return json(mapAgent(row!), 200);
          }
          // Brand-new agent — persist the normalized name.
          const row = await db.get<Row>(
            `INSERT INTO agents (id, name, description, session_id, project_id, capabilities, permissions, status, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'active','{}') RETURNING *`,
            [
              uuid(),
              name,
              (body.description as string) ?? null,
              sessionId,
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
      // `filters` are exact-match columns (col = $n). `search` (when present)
      // maps the `search` query param to a case-insensitive substring (ILIKE)
      // match over the listed columns, ordered newest-first. NOTE: this differs
      // from LocalStore.searchMessages, which uses SQLite FTS5 (tokenized MATCH,
      // relevance-ranked); the ILIKE path is a recency-ordered substring match,
      // not a token-relevance search. `phone` maps the `number` query param to
      // (from_number = $n OR to_number = $n) — parity with
      // LocalStore.getConversation. Both must be served DB-side so cloud never
      // silently searches only the most-recent page at fleet scale.
      const listOnly: Record<
        string,
        { table: string; order: string; map: (r: Row) => unknown; filters: string[]; bools?: string[]; search?: string[]; phone?: boolean }
      > = {
        "/v1/numbers": { table: "phone_numbers", order: "created_at DESC", map: mapNumber, filters: ["agent_id", "project_id", "status", "number"] },
        "/v1/messages": { table: "messages", order: "created_at DESC", map: mapMessage, filters: ["agent_id", "project_id", "type"], search: ["body"], phone: true },
        "/v1/calls": { table: "calls", order: "started_at DESC", map: mapCall, filters: ["agent_id", "project_id"] },
        "/v1/voicemails": { table: "voicemails", order: "created_at DESC", map: mapVoicemail, filters: ["agent_id", "project_id", "listened"], bools: ["listened"] },
      };
      if (listOnly[path] && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = listOnly[path]!;
        const limit = clampLimit(url.searchParams.get("limit"));
        const where: string[] = [];
        const params: unknown[] = [];
        for (const col of spec.filters) {
          const val = url.searchParams.get(col);
          if (val != null && val !== "") {
            // Boolean filter columns (e.g. voicemails.listened) arrive as the
            // strings "true"/"false"; bind a real boolean so Postgres compares
            // boolean = boolean rather than boolean = text.
            params.push(spec.bools?.includes(col) ? val === "true" || val === "1" : val);
            where.push(`${col} = $${params.length}`);
          }
        }
        if (spec.search) {
          const term = url.searchParams.get("search");
          if (term != null && term !== "") {
            params.push(`%${term}%`);
            const idx = params.length;
            where.push(`(${spec.search.map((c) => `${c} ILIKE $${idx}`).join(" OR ")})`);
          }
        }
        if (spec.phone) {
          const num = url.searchParams.get("number");
          if (num != null && num !== "") {
            params.push(num);
            const idx = params.length;
            where.push(`(from_number = $${idx} OR to_number = $${idx})`);
          }
        }
        const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const rows = await db.many<Row>(
          `SELECT * FROM ${spec.table} ${clause} ORDER BY ${spec.order} LIMIT ${limit}`,
          params,
        );
        return json({ items: rows.map(spec.map), total: rows.length });
      }
      // ---- Twilio provider passthrough (server-side proxy) ----
      // Live reads against the Twilio API using the server's Twilio credential
      // (from Secrets Manager / env — NEVER distributed to clients). ApiStore
      // routes CLI/MCP/SDK `searchAvailableNumbers` / `listTwilioNumbers` here so
      // the client never holds real Twilio creds. Read-only, additive, reversible.
      // Placed BEFORE the `/v1/numbers/:id` single-GET matcher so the literal
      // sub-paths aren't captured as an id lookup.
      if (path === "/v1/numbers/available" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasTwilioConfig()) {
          return json({ error: "twilio_not_configured", message: "Server has no Twilio credential configured." }, 501);
        }
        const country = url.searchParams.get("country") || "US";
        const limit = clampLimit(url.searchParams.get("limit"), 10, 50);
        const params: Record<string, unknown> = { limit };
        const areaCode = url.searchParams.get("area_code");
        const contains = url.searchParams.get("contains");
        const smsEnabled = url.searchParams.get("sms_enabled");
        const voiceEnabled = url.searchParams.get("voice_enabled");
        if (areaCode) params.areaCode = parseInt(areaCode, 10);
        if (contains) params.contains = contains;
        if (smsEnabled != null) params.smsEnabled = smsEnabled === "true" || smsEnabled === "1";
        if (voiceEnabled != null) params.voiceEnabled = voiceEnabled === "true" || voiceEnabled === "1";
        try {
          const numbers = await getTwilioClient().availablePhoneNumbers(country).local.list(params);
          const items = numbers.map((n) => ({
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName,
            locality: n.locality,
            region: n.region,
            capabilities: { voice: n.capabilities.voice, sms: n.capabilities.sms, mms: n.capabilities.mms },
          }));
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "twilio_error", message: err instanceof Error ? err.message : "twilio request failed" }, 502);
        }
      }
      if (path === "/v1/numbers/twilio" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasTwilioConfig()) {
          return json({ error: "twilio_not_configured", message: "Server has no Twilio credential configured." }, 501);
        }
        try {
          const numbers = await getTwilioClient().incomingPhoneNumbers.list({ limit: 100 });
          const items = numbers.map((n) => ({ sid: n.sid, phoneNumber: n.phoneNumber, friendlyName: n.friendlyName }));
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "twilio_error", message: err instanceof Error ? err.message : "twilio request failed" }, 502);
        }
      }
      // ---- ElevenLabs provider passthrough (server-side proxy) ----
      // Live read of TTS voices using the server's ElevenLabs credential (from
      // Secrets Manager / env — NEVER distributed to clients). ApiStore routes
      // CLI/MCP/SDK `listVoices` here so the client never holds a real
      // ElevenLabs key. Read-only, additive, reversible.
      if (path === "/v1/voices" && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        if (!hasElevenLabsConfig()) {
          return json({ error: "elevenlabs_not_configured", message: "Server has no ElevenLabs credential configured." }, 501);
        }
        try {
          const items = await fetchVoicesFromProvider();
          return json({ items, total: items.length });
        } catch (err) {
          return json({ error: "elevenlabs_error", message: err instanceof Error ? err.message : "elevenlabs request failed" }, 502);
        }
      }

      const singleGet: Record<string, { table: string; map: (r: Row) => unknown }> = {
        numbers: { table: "phone_numbers", map: mapNumber },
        messages: { table: "messages", map: mapMessage },
        calls: { table: "calls", map: mapCall },
        voicemails: { table: "voicemails", map: mapVoicemail },
        agents: { table: "agents", map: mapAgent },
      };
      const singleMatch = path.match(/^\/v1\/(numbers|messages|calls|voicemails|agents)\/([^/]+)$/);
      if (singleMatch && method === "GET") {
        await authOrThrow(req, ["telephony:read"]);
        const spec = singleGet[singleMatch[1]!]!;
        const row = await db.get<Row>(`SELECT * FROM ${spec.table} WHERE id = $1`, [
          decodeURIComponent(singleMatch[2]!),
        ]);
        return row ? json(spec.map(row)) : json({ error: "not_found" }, 404);
      }

      // ---- writes for numbers/messages/calls/voicemails ----
      // ApiStore (client-flip cloud transport) routes provider-side records
      // (createMessage/updateMessageStatus, createCall/updateCallStatus,
      // createVoicemail/markVoicemailListened, createPhoneNumber/assign/release)
      // through these. Requires an ECS redeploy after ship.
      if (path === "/v1/messages" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO messages (id, type, from_number, to_number, body, media_url, status, agent_id, project_id, twilio_sid, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            uuid(),
            requireString(body, "type"),
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            (body.body as string) ?? null,
            (body.media_url as string) ?? null,
            typeof body.status === "string" ? body.status : "queued",
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapMessage(row!), 201);
      }
      if (path === "/v1/calls" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO calls (id, direction, from_number, to_number, status, agent_id, project_id, twilio_sid, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            uuid(),
            requireString(body, "direction"),
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            typeof body.status === "string" ? body.status : "initiated",
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapCall(row!), 201);
      }
      if (path === "/v1/voicemails" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO voicemails (id, call_id, from_number, to_number, recording_url, local_path, transcription, duration, agent_id, project_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            uuid(),
            (body.call_id as string) ?? null,
            requireString(body, "from_number"),
            requireString(body, "to_number"),
            (body.recording_url as string) ?? null,
            (body.local_path as string) ?? null,
            (body.transcription as string) ?? null,
            typeof body.duration === "number" ? body.duration : null,
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
          ],
        );
        return json(mapVoicemail(row!), 201);
      }
      if (path === "/v1/numbers" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        const row = await db.get<Row>(
          `INSERT INTO phone_numbers (id, number, country, capabilities, agent_id, project_id, twilio_sid, friendly_name, status, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            uuid(),
            requireString(body, "number"),
            typeof body.country === "string" ? body.country : "US",
            JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : ["sms", "voice"]),
            (body.agent_id as string) ?? null,
            (body.project_id as string) ?? null,
            (body.twilio_sid as string) ?? null,
            (body.friendly_name as string) ?? null,
            typeof body.status === "string" ? body.status : "active",
            JSON.stringify((body.metadata as Record<string, unknown>) ?? {}),
          ],
        );
        return json(mapNumber(row!), 201);
      }
      const writeSingle = path.match(/^\/v1\/(numbers|messages|calls|voicemails)\/([^/]+)$/);
      if (writeSingle && method === "PATCH") {
        await authOrThrow(req, ["telephony:write"]);
        const resource = writeSingle[1]!;
        const id = decodeURIComponent(writeSingle[2]!);
        const body = await readBody(req);
        const table = singleGet[resource]!.table;
        const mapper = singleGet[resource]!.map;
        const allowed: Record<string, string[]> = {
          messages: ["status", "error_message", "twilio_sid"],
          calls: ["status", "duration", "recording_url", "transcription", "ended_at", "twilio_sid"],
          voicemails: ["listened", "transcription", "local_path"],
          numbers: ["agent_id", "project_id", "status", "friendly_name"],
        };
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const col of allowed[resource]!) {
          if (body[col] !== undefined) {
            params.push(body[col]);
            sets.push(`${col} = $${params.length}`);
          }
        }
        if (sets.length === 0) {
          const row = await db.get<Row>(`SELECT * FROM ${table} WHERE id = $1`, [id]);
          return row ? json(mapper(row)) : json({ error: "not_found" }, 404);
        }
        // calls/voicemails have no updated_at column; only bump it where present.
        if (resource === "messages" || resource === "numbers") sets.push(`updated_at = NOW()`);
        params.push(id);
        const row = await db.get<Row>(
          `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        return row ? json(mapper(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/agents/:id (heartbeat / release / focus) ----
      const agentPatch = path.match(/^\/v1\/agents\/([^/]+)$/);
      if (agentPatch && method === "PATCH") {
        await authOrThrow(req, ["telephony:write"]);
        const id = decodeURIComponent(agentPatch[1]!);
        const body = await readBody(req);
        const sets: string[] = [];
        const params: unknown[] = [];
        for (const col of ["status", "project_id", "description"]) {
          if (body[col] !== undefined) {
            params.push(body[col]);
            sets.push(`${col} = $${params.length}`);
          }
        }
        // Any PATCH is treated as liveness — bump last_seen_at + updated_at.
        sets.push(`last_seen_at = NOW()`, `updated_at = NOW()`);
        params.push(id);
        const row = await db.get<Row>(
          `UPDATE agents SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        return row ? json(mapAgent(row)) : json({ error: "not_found" }, 404);
      }

      // ---- /v1/feedback ----
      if (path === "/v1/feedback" && method === "POST") {
        await authOrThrow(req, ["telephony:write"]);
        const body = await readBody(req);
        await db.query(
          `INSERT INTO feedback (message, email, category, version) VALUES ($1,$2,$3,$4)`,
          [
            requireString(body, "message"),
            (body.email as string) ?? null,
            typeof body.category === "string" ? body.category : "general",
            (body.version as string) ?? null,
          ],
        );
        return json({ status: "ok" }, 201);
      }

      // ---- /v1/schedules ----
      if (path === "/v1/schedules") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          // Parity with LocalStore.listSchedules: agent_id/project_id (exact) and
          // enabled (boolean) filters served DB-side, not silently dropped.
          const where: string[] = [];
          const params: unknown[] = [];
          for (const col of ["agent_id", "project_id"]) {
            const val = url.searchParams.get(col);
            if (val != null && val !== "") {
              params.push(val);
              where.push(`${col} = $${params.length}`);
            }
          }
          const enabledRaw = url.searchParams.get("enabled");
          if (enabledRaw != null && enabledRaw !== "") {
            params.push(enabledRaw === "true" || enabledRaw === "1");
            where.push(`enabled = $${params.length}`);
          }
          const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
          const rows = await db.many<Row>(
            `SELECT * FROM schedules ${clause} ORDER BY created_at DESC LIMIT 200`,
            params,
          );
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
      if (scheduleMatch) {
        const id = decodeURIComponent(scheduleMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM schedules WHERE id = $1`, [id]);
          return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["telephony:write"]);
          const body = await readBody(req);
          const sets: string[] = [];
          const params: unknown[] = [];
          for (const col of ["enabled", "last_run", "next_run", "run_count"]) {
            if (body[col] !== undefined) {
              params.push(body[col]);
              sets.push(`${col} = $${params.length}`);
            }
          }
          if (sets.length === 0) {
            const row = await db.get<Row>(`SELECT * FROM schedules WHERE id = $1`, [id]);
            return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
          }
          sets.push(`updated_at = NOW()`);
          params.push(id);
          const row = await db.get<Row>(
            `UPDATE schedules SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
            params,
          );
          return row ? json(mapSchedule(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM schedules WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      // ---- private server-to-server dispatch targets ----
      // This route intentionally is not part of the public OpenAPI document.
      // It carries webhook signing material and must require a dedicated
      // dispatch scope, while public /v1/webhooks returns only secret_configured.
      if (path === "/v1/internal/webhook-dispatch-targets") {
        if (method === "GET") {
          await authOrThrow(req, ["telephony:dispatch"]);
          const rows = await db.many<Row>(`SELECT * FROM webhooks ORDER BY created_at DESC LIMIT 200`);
          return json({ items: rows.map(mapWebhookDispatchTarget), total: rows.length });
        }
        return json({ error: "method_not_allowed" }, 405);
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
      if (webhookMatch) {
        const id = decodeURIComponent(webhookMatch[1]!);
        if (method === "GET") {
          await authOrThrow(req, ["telephony:read"]);
          const row = await db.get<Row>(`SELECT * FROM webhooks WHERE id = $1`, [id]);
          return row ? json(mapWebhook(row)) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["telephony:write"]);
          const result = await db.query(`DELETE FROM webhooks WHERE id = $1`, [id]);
          return result.rowCount > 0 ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
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
