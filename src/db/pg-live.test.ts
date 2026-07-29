/**
 * Live PostgreSQL gate for the cloud (PURE REMOTE) storage path.
 *
 * This is the test named by `storage.pgTestGate` in hasna.contract.json — the
 * proof that telephony's declared `postgres` storage engine is a real, working
 * capability and not a manifest claim. It is skipped unless a disposable
 * PostgreSQL is supplied:
 *
 *   HASNA_TELEPHONY_TEST_DATABASE_URL=postgres://user:pw@host:5432/db \
 *     bun test src/db/pg-live.test.ts
 *
 * Everything it creates lives in a randomly named scratch schema (selected via
 * the libpq `options=-c search_path=...` connection parameter) that is dropped
 * again in teardown, so pointing it at a database with other content does not
 * collide with or destroy that content. The connection string is never logged.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import pg from "pg";
import { MigrationLedger, defineMigration, type Migration } from "../generated/storage-kit/index.js";
import type { PoolQueryClient } from "../generated/storage-kit/index.js";
import { PG_MIGRATIONS } from "../lib/pg-migrations.js";
import { createTelephonyCloudClient } from "./remote-storage.js";

const testDatabaseUrl = process.env.HASNA_TELEPHONY_TEST_DATABASE_URL?.trim();

/**
 * Build the telephony migration set exactly as `scripts/apply-cloud-migrations.mjs`
 * does, minus the `@hasna/contracts/auth` api-key ledger: this gate proves the
 * telephony schema itself, not the shared auth tables.
 */
function telephonyMigrations(): Migration[] {
  return [
    defineMigration("telephony_pg_000_extensions", "CREATE EXTENSION IF NOT EXISTS pgcrypto"),
    ...PG_MIGRATIONS.map((sql, index) =>
      defineMigration(`telephony_pg_${String(index + 1).padStart(3, "0")}`, sql),
    ),
  ];
}

/** Point the canonical HASNA_TELEPHONY_* env contract at `dsn` in `schema`. */
function scopedDsn(dsn: string, schema: string): string {
  const url = new URL(dsn);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

const describeLive = testDatabaseUrl ? describe : describe.skip;

describeLive("live PostgreSQL storage engine", () => {
  const schema = `telephony_pg_live_${Math.random().toString(36).slice(2, 10)}`;
  const savedEnv: Record<string, string | undefined> = {};
  let client: PoolQueryClient;

  beforeAll(async () => {
    const dsn = testDatabaseUrl as string;
    const admin = new pg.Pool({ connectionString: dsn });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await admin.end();
    }

    for (const key of ["HASNA_TELEPHONY_STORAGE_MODE", "HASNA_TELEPHONY_DATABASE_URL"]) {
      savedEnv[key] = process.env[key];
    }
    // Drive the real shipped path: mode + DSN come from the canonical env
    // contract, and the client is the one the serve process uses.
    process.env.HASNA_TELEPHONY_STORAGE_MODE = "cloud";
    process.env.HASNA_TELEPHONY_DATABASE_URL = scopedDsn(dsn, schema);
    client = createTelephonyCloudClient();
  });

  afterAll(async () => {
    await client?.close();
    const admin = new pg.Pool({ connectionString: testDatabaseUrl as string });
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("connects through the canonical HASNA_TELEPHONY_* env contract", async () => {
    const row = await client.one<{ schema: string }>("SELECT current_schema() AS schema");
    expect(row.schema).toBe(schema);
  });

  it("applies the telephony Postgres migrations idempotently", async () => {
    const migrations = telephonyMigrations();
    const first = await new MigrationLedger(client, migrations).migrate();
    expect(first.plan.every((item) => item.state === "pending")).toBe(true);
    expect(first.applied.map((row) => row.id)).toEqual(migrations.map((m) => m.id));

    const second = await new MigrationLedger(client, migrations).migrate();
    expect(second.plan.every((item) => item.state === "already_applied")).toBe(true);
  });

  it("round-trips a row through the migrated schema", async () => {
    await new MigrationLedger(client, telephonyMigrations()).migrate();

    const id = `prj_${Math.random().toString(36).slice(2, 10)}`;
    await client.execute("INSERT INTO projects (id, name, path) VALUES ($1, $2, $3)", [
      id,
      "pg-live-gate",
      `/tmp/${id}`,
    ]);

    const stored = await client.get<{ id: string; name: string }>(
      "SELECT id, name FROM projects WHERE id = $1",
      [id],
    );
    expect(stored).toEqual({ id, name: "pg-live-gate" });

    await client.execute("DELETE FROM projects WHERE id = $1", [id]);
    expect(await client.get("SELECT id FROM projects WHERE id = $1", [id])).toBeNull();
  });

  it("rolls a failed transaction back", async () => {
    await new MigrationLedger(client, telephonyMigrations()).migrate();

    const id = `prj_${Math.random().toString(36).slice(2, 10)}`;
    await expect(
      client.transaction(async (tx) => {
        await tx.execute("INSERT INTO projects (id, name, path) VALUES ($1, $2, $3)", [
          id,
          "rollback-probe",
          `/tmp/${id}`,
        ]);
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");

    expect(await client.get("SELECT id FROM projects WHERE id = $1", [id])).toBeNull();
  });
});
