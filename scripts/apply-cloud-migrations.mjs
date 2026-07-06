#!/usr/bin/env bun
/**
 * Apply the @hasna/telephony cloud-mode Postgres schema via the vendored
 * storage kit's MigrationLedger (checksum ledger + drift/downgrade guards).
 *
 * PURE REMOTE (Amendment A1): runs against the shared cloud Postgres only.
 * Requires:
 *   HASNA_TELEPHONY_STORAGE_MODE=cloud
 *   HASNA_TELEPHONY_DATABASE_URL=postgres://...   (never logged)
 *
 * Usage:
 *   bun scripts/apply-cloud-migrations.mjs [--dry-run] [--json]
 *
 * The DATABASE_URL value is never printed. Fetch it into the environment from
 * Secrets Manager without echoing, e.g.:
 *   export HASNA_TELEPHONY_DATABASE_URL="$(aws secretsmanager get-secret-value \
 *     --secret-id hasna/oss/telephony/database-url-owner --query SecretString --output text)"
 */
import {
  PG_MIGRATIONS,
  MigrationLedger,
  defineMigration,
  createTelephonyCloudClient,
} from "../src/storage.ts";
import { apiKeyMigrations } from "@hasna/contracts/auth";

const dryRun = process.argv.includes("--dry-run");
const asJson = process.argv.includes("--json");

// Migrations run DDL and therefore need the DB OWNER role. Prefer an
// owner-scoped DSN when one is injected (HASNA_TELEPHONY_DATABASE_URL_OWNER),
// falling back to the standard app DSN for local/dev runs. The resolved value
// is written to HASNA_TELEPHONY_DATABASE_URL so the cloud client picks it up.
// Also restore kit-intended sslmode=require semantics under node-postgres
// >= 8.22 (see src/server/cloud-serve.ts::normalizeCloudDatabaseUrl). Never
// logs the URL.
{
  const key = "HASNA_TELEPHONY_DATABASE_URL";
  let url = process.env.HASNA_TELEPHONY_DATABASE_URL_OWNER ?? process.env[key];
  if (url) {
    const lower = url.toLowerCase();
    if (
      (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) &&
      !lower.includes("uselibpqcompat")
    ) {
      url = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
    }
    process.env[key] = url;
  }
  // Migrations always target cloud Postgres.
  process.env.HASNA_TELEPHONY_STORAGE_MODE = "cloud";
}

// The extension migration must run before table DDL that relies on
// gen_random_uuid()/pgcrypto. Kept first and stable.
//
// The api-keys ledger (from @hasna/contracts/auth) backs the serve API-key
// auth middleware. Its ids are namespaced ("api_keys_*") so they never clash
// with the telephony_pg_* schema migrations, and they run last (additive).
const migrations = [
  defineMigration("telephony_pg_000_extensions", "CREATE EXTENSION IF NOT EXISTS pgcrypto"),
  ...PG_MIGRATIONS.map((sql, index) =>
    defineMigration(`telephony_pg_${String(index + 1).padStart(3, "0")}`, sql),
  ),
  ...apiKeyMigrations().map((m) => defineMigration(m.id, m.sql)),
];

const client = createTelephonyCloudClient();
try {
  const ledger = new MigrationLedger(client, migrations);
  const result = await ledger.migrate({ dryRun });
  const pending = result.plan.filter((item) => item.state === "pending").map((item) => item.migration.id);
  const summary = {
    ok: true,
    dryRun,
    total: migrations.length,
    alreadyApplied: result.plan.length - pending.length,
    pending,
  };
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(
      `[telephony] migrations ${dryRun ? "plan (dry-run)" : "applied"}: total=${summary.total} already=${summary.alreadyApplied} pending=${pending.length}`,
    );
    if (pending.length) console.log(`[telephony] pending: ${pending.join(", ")}`);
  }
} finally {
  await client.close();
}
