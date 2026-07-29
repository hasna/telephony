import type { TypedQueryClient } from "../generated/storage-kit/index.js";
import {
  clampLimit,
  json,
  mapContact,
  mapProject,
  requireString,
  uuid,
  type Row,
} from "./cloud-api-support.js";

interface DirectoryRouteContext {
  db: TypedQueryClient;
  req: Request;
  url: URL;
  path: string;
  method: string;
  authOrThrow: (req: Request, requiredScopes: string[]) => Promise<unknown>;
  readBody: (req: Request) => Promise<Record<string, unknown>>;
}

/** Handle contact and project routes, returning undefined for unrelated paths. */
export async function handleDirectoryRoutes({
  db,
  req,
  url,
  path,
  method,
  authOrThrow,
  readBody,
}: DirectoryRouteContext): Promise<Response | undefined> {
  // ---- /v1/contacts (full CRUD) ----
  if (path === "/v1/contacts") {
    if (method === "GET") {
      await authOrThrow(req, ["telephony:read"]);
      const limit = clampLimit(url.searchParams.get("limit"));
      const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
      const search = url.searchParams.get("search");
      const params: unknown[] = [];
      const conds: string[] = [];
      // Parity with LocalStore.listContacts: agent_id/project_id are exact
      // scoping filters. Dropping them in cloud mode over-exposed every
      // agent's contacts across the shared fleet.
      for (const col of ["agent_id", "project_id"]) {
        const val = url.searchParams.get(col);
        if (val != null && val !== "") {
          params.push(val);
          conds.push(`${col} = $${params.length}`);
        }
      }
      if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        conds.push(`(name ILIKE $${idx} OR phone ILIKE $${idx} OR email ILIKE $${idx})`);
      }
      const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
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
  return undefined;
}

