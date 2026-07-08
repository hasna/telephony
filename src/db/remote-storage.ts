import type { Pool } from "pg";
import {
  createCloudPoolFromEnv,
  type PoolQueryClient,
} from "../generated/storage-kit/index.js";

/** App name used for the canonical HASNA_TELEPHONY_* env contract. */
export const TELEPHONY_APP_NAME = "telephony";

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
