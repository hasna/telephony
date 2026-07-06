import type { Pool, QueryResultRow } from "pg";
import {
  createCloudPoolFromEnv,
  createPgPool,
  createQueryClient,
  type PoolQueryClient,
} from "../generated/storage-kit/index.js";

/** App name used for the canonical HASNA_TELEPHONY_* env contract. */
export const TELEPHONY_APP_NAME = "telephony";

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => (value === undefined ? null : value));
}

/**
 * Async Postgres adapter for telephony cloud-mode access.
 *
 * All pg access — TLS handling, pooling, and the typed query surface — is
 * delegated to the vendored `@hasna/contracts` storage kit
 * (`src/generated/storage-kit`).
 *
 * PURE REMOTE (Amendment A1): cloud mode reads AND writes go directly to the
 * shared cloud Postgres. There is no cache, no local mirror, and no merge —
 * every call round-trips to the database.
 */
export class PgAdapterAsync {
  private readonly client: PoolQueryClient;

  constructor(connectionString: string) {
    const pool = createPgPool({
      connectionString,
      applicationName: "@hasna/telephony",
    });
    attachPoolErrorHandler(pool);
    this.client = createQueryClient(pool);
  }

  /** Underlying pg pool (fleet-standard TLS applied). */
  get pool(): Pool {
    return this.client.pool;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  /** First row or `null`. */
  async get<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T | null> {
    return this.client.get<T>(translatePlaceholders(sql), normalizeParams(params));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Build a PURE REMOTE cloud query client from the environment.
 *
 * Requires `HASNA_TELEPHONY_STORAGE_MODE=cloud` and
 * `HASNA_TELEPHONY_DATABASE_URL`. Throws (without logging the URL) when the
 * mode is not `cloud` or the URL is missing. Returns the kit's typed client so
 * callers get `query/many/get/one/execute/transaction` uniformly.
 */
export function createTelephonyCloudClient(): PoolQueryClient {
  const client = createCloudPoolFromEnv(TELEPHONY_APP_NAME, {
    applicationName: "@hasna/telephony",
  }).client;
  attachPoolErrorHandler(client.pool);
  return client;
}

/**
 * Attach an `error` listener to a `pg.Pool` so an idle-client disconnect
 * (RDS failover, network blip, or a dropped SSH/SSM tunnel in dev) does not
 * crash the process with an unhandled `error` event. The pool transparently
 * reconnects on the next query; here we only log and swallow so the service
 * stays up. Never logs credentials.
 */
export function attachPoolErrorHandler(pool: Pool): void {
  // `on` is idempotent enough for our use; guard against double-registration.
  if ((pool as unknown as { __hasnaErrHandler?: boolean }).__hasnaErrHandler) return;
  (pool as unknown as { __hasnaErrHandler?: boolean }).__hasnaErrHandler = true;
  pool.on("error", (err: Error) => {
    console.warn(`[telephony] idle pg client error (pool will reconnect): ${err.message}`);
  });
}
