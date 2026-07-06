#!/usr/bin/env bun
/**
 * telephony-serve entrypoint — the self-hosted HTTP API (PURE REMOTE / A1).
 *
 * Starts the cloud serve, which reads/writes the shared cloud Postgres directly
 * and authenticates requests with @hasna/contracts API-key middleware. Requires
 * HASNA_TELEPHONY_STORAGE_MODE=cloud + HASNA_TELEPHONY_DATABASE_URL and a
 * signing secret (HASNA_TELEPHONY_API_SIGNING_KEY).
 */
import { startTelephonyServe } from "./cloud-serve.js";

startTelephonyServe().catch((error) => {
  console.error("[telephony-serve] failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
