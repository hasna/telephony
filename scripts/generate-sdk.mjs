#!/usr/bin/env bun
/**
 * Generate the typed telephony SDK client from the serve OpenAPI document.
 *
 * The OpenAPI spec is the single source of truth (also served at
 * GET /openapi.json). The generated client is a dependency-free fetch client
 * committed to src/generated/telephony-api-client.ts and re-exported from the
 * package root, so `@hasna/telephony` consumers get a typed self-hosted client.
 *
 *   bun scripts/generate-sdk.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { telephonyOpenApi } from "../src/server/cloud-serve.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await Bun.file(join(root, "package.json")).text());
const spec = telephonyOpenApi(pkg.version);

const { code, operations, warnings } = generateSdkFromOpenApi(spec, {
  className: "TelephonyApiClient",
  apiKeyHeader: "x-api-key",
});

const outDir = join(root, "src", "generated");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "telephony-api-client.ts");
const header =
  "// @generated from the telephony-serve OpenAPI document by scripts/generate-sdk.mjs.\n" +
  "// DO NOT EDIT. Regenerate: bun scripts/generate-sdk.mjs\n\n";
writeFileSync(outFile, header + code);

console.log(`[telephony] generated SDK: ${operations.length} operations -> ${outFile}`);
if (warnings.length) console.warn(`[telephony] SDK warnings:\n  ${warnings.join("\n  ")}`);
