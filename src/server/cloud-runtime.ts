/**
 * Cloud service bootstrap and environment configuration.
 */
import { readFileSync } from "node:fs";
import { ApiKeyStore, verifyApiKey } from "@hasna/contracts/auth";
import { createTelephonyCloudClient } from "../db/remote-storage.js";
import { createServeHandler } from "./cloud-handler.js";

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

