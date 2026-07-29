#!/usr/bin/env bun
/**
 * Packed-artifact release gate — the script named by
 * `metadata.release.artifactScan.script` in hasna.contract.json and required by
 * the @hasna/contracts `published_artifact_gate` conformance clause.
 *
 * This is NOT the diff-time secrets scan that runs before a commit. It runs
 * against the PACKED TARBALL — the exact bytes `npm pack` produces and
 * `npm publish` ships — and asserts, on the real extracted file set:
 *
 *   1. no credential pattern appears in any shipped file;
 *   2. no file that must never ship rode along (node_modules, VCS/CI metadata,
 *      real dotenv files, internal scratch dirs);
 *   3. no shipped file is a bulk asset inventory (a dump of hostnames, public
 *      IPs, or email addresses), using the @hasna/contracts default thresholds;
 *   4. the artifact stays slim — entry-count / total-size / per-file ceilings
 *      catch an accidental node_modules- or binary-scale inclusion.
 *
 * Wired into `prepack`, so `npm publish` cannot ship an artifact this never
 * inspected. Exits non-zero with a per-hit report on any violation.
 *
 * Usage:
 *   bun scripts/scan-artifact.mjs [--json]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const asJson = process.argv.includes("--json");

/**
 * Anti-bloat ceilings. Blowup detectors, not exact assertions: the shipped set
 * is defined by package.json `files[]`, and the published 0.2.8 artifact is 195
 * entries / ~1.4 MB. These leave room to grow while still catching a
 * node_modules- or binary-scale accident (thousands of files, tens of MB).
 */
const MAX_ENTRIES = 500;
const MAX_UNPACKED_BYTES = 24 * 1024 * 1024;
const MAX_FILE_BYTES = 6 * 1024 * 1024;

/**
 * Bulk asset-inventory thresholds, matching the @hasna/contracts
 * `artifact-scan` defaults. Distinct values in ONE shipped file above these
 * counts is an inventory, not incidental documentation.
 */
const INVENTORY_THRESHOLDS = { host: 25, ip: 20, email: 15 };

/**
 * Credential patterns. Each source is assembled from fragments so this file
 * does not match itself when it is scanned as part of the artifact — the same
 * technique src/db/no-shared-cloud-contract.test.ts uses.
 */
const SECRET_RULES = [
  ["anthropic-api-key", new RegExp("sk-" + "ant-" + "[A-Za-z0-9_-]{16,}")],
  ["openai-project-key", new RegExp("sk-" + "proj-" + "[A-Za-z0-9_-]{16,}")],
  ["npm-token", new RegExp("npm_" + "[A-Za-z0-9]{36}")],
  ["github-token", new RegExp("gh[pousr]" + "_" + "[A-Za-z0-9]{36,}")],
  ["aws-access-key-id", new RegExp("AKIA" + "[0-9A-Z]{16}")],
  ["xai-api-key", new RegExp("xai-" + "[A-Za-z0-9]{32,}")],
  ["google-api-key", new RegExp("AIza" + "[0-9A-Za-z_-]{35}")],
  ["context7-key", new RegExp("ctx7sk-" + "[A-Za-z0-9-]{16,}")],
  ["private-key-block", new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----")],
];

/**
 * A DSN carrying a real password must never ship. Documentation DSNs are
 * everywhere in this repo, so the password segment is compared against the
 * placeholder shapes docs actually use before a hit is raised.
 */
const DSN_PASSWORD_PATTERN = new RegExp("postgres(?:ql)?://" + "[^\\s:@/]+:([^\\s:@/]+)@", "g");
const PLACEHOLDER_PASSWORD =
  /^(?:pw|pass|password|passwd|secret|user|username|changeme|x+|\*+|\.{3}|<[^>]*>|\$\{[^}]*\}|%[^%]*%|[A-Z][A-Z0-9_]*)$/;

const URL_HOST_PATTERN = /\bhttps?:\/\/([A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9])/gi;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,24}\b/g;
const RESERVED_HOST_SUFFIXES = ["example.com", "example.net", "example.org", "localhost", ".test", ".invalid", ".local"];

function run(cmd, args, cwd, env) {
  const result = spawnSync(cmd, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(" ")}\` failed (status ${result.status}): ` +
        `${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
  return result.stdout;
}

/**
 * Pack the repo into a real `.tgz` in `destDir` and return its path.
 *
 * `--ignore-scripts` is mandatory rather than an optimisation: this scanner is
 * invoked FROM `prepack`, and a plain `npm pack` would re-run `prepack` and
 * recurse. `npm_config_dry_run=false` undoes an outer `npm pack --dry-run`,
 * which would otherwise make this nested pack report a filename it never wrote.
 */
export function packRepo(root, destDir) {
  const stdout = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destDir], root, {
    ...process.env,
    npm_config_dry_run: "false",
  });
  const filename = JSON.parse(stdout)[0]?.filename;
  if (!filename) throw new Error("npm pack reported no filename");
  const tgz = join(destDir, filename);
  if (!existsSync(tgz)) throw new Error(`npm pack reported '${filename}' but it is not on disk`);
  return tgz;
}

/** Files that must never ship regardless of `files[]` — returns a reason or null. */
export function forbiddenReason(path) {
  const base = path.split("/").pop() ?? path;
  if (/(^|\/)node_modules\//.test(path)) return "node_modules must never ship";
  if (/(^|\/)\.git\//.test(path)) return "VCS metadata must never ship";
  if (/(^|\/)\.github\//.test(path)) return "CI config (.github) must never ship";
  if (/(^|\/)\.hasna\//.test(path)) return "internal scratch (.hasna) must never ship";
  if (/^\.env(\.|$)/.test(base) && !/\.(example|sample|template)$/.test(base)) {
    return "dotenv file must never ship";
  }
  return null;
}

function isReservedHost(host) {
  const lower = host.toLowerCase();
  return RESERVED_HOST_SUFFIXES.some((suffix) => lower === suffix || lower.endsWith(suffix));
}

function isPublicIpv4(value) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

/** Line number (1-based) of `index` within `content`. */
function lineOf(content, index) {
  return content.slice(0, index).split("\n").length;
}

/** Credential findings for one shipped file. Never returns the matched value. */
export function secretFindings(content) {
  const findings = [];
  for (const [ruleId, pattern] of SECRET_RULES) {
    const hit = new RegExp(pattern.source).exec(content);
    if (hit) findings.push({ ruleId, line: lineOf(content, hit.index) });
  }
  for (const hit of content.matchAll(DSN_PASSWORD_PATTERN)) {
    if (PLACEHOLDER_PASSWORD.test(hit[1] ?? "")) continue;
    findings.push({ ruleId: "postgres-dsn-password", line: lineOf(content, hit.index) });
  }
  return findings;
}

/**
 * Distinct hostname / public-IP / email counts for one shipped file. Hostnames
 * are taken from real URLs only — a bare dotted token in source is far more
 * often a property access or a filename than a host.
 */
export function inventoryCounts(content) {
  const hosts = new Set();
  for (const match of content.matchAll(URL_HOST_PATTERN)) {
    const host = (match[1] ?? "").toLowerCase();
    if (host && !isReservedHost(host)) hosts.add(host);
  }
  const ips = new Set((content.match(IPV4_PATTERN) ?? []).filter(isPublicIpv4));
  const emails = new Set((content.match(EMAIL_PATTERN) ?? []).map((value) => value.toLowerCase()));
  return { host: hosts.size, ip: ips.size, email: emails.size };
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() ? [absolute] : [];
  });
}

/** Extract `tgz` and scan every shipped file. */
export function scanPackedTarball(tgz) {
  const workdir = mkdtempSync(join(tmpdir(), "telephony-artifact-scan-"));
  const violations = [];
  const files = [];
  let unpackedSize = 0;

  try {
    run("tar", ["-xzf", tgz, "-C", workdir]);
    // npm tarballs root every entry under `package/`.
    const packed = join(workdir, "package");
    const base = existsSync(packed) ? packed : workdir;

    for (const absolute of walk(base)) {
      const path = relative(base, absolute).split(sep).join("/");
      const size = statSync(absolute).size;
      files.push({ path, size });
      unpackedSize += size;

      if (size > MAX_FILE_BYTES) {
        violations.push({ kind: "bloat", path, detail: `file is ${size} bytes (> ${MAX_FILE_BYTES} ceiling)` });
      }

      const forbidden = forbiddenReason(path);
      if (forbidden) violations.push({ kind: "forbidden-file", path, detail: forbidden });

      // Read every shipped file as text. Binary-looking files are deliberately
      // not skipped: a planted NUL byte is a cheap way to make a text secret
      // look binary, and this package ships no real binaries.
      const content = readFileSync(absolute).toString("utf8");

      // Never print the matched value — only which rule fired and where.
      for (const finding of secretFindings(content)) {
        violations.push({ kind: "secret", path, detail: `${finding.ruleId} at line ${finding.line}` });
      }

      const counts = inventoryCounts(content);
      for (const [kind, threshold] of Object.entries(INVENTORY_THRESHOLDS)) {
        if (counts[kind] > threshold) {
          violations.push({
            kind: "asset-inventory",
            path,
            detail: `${counts[kind]} distinct ${kind} values (> ${threshold} threshold)`,
          });
        }
      }
    }

    if (files.length > MAX_ENTRIES) {
      violations.push({
        kind: "bloat",
        detail: `${files.length} entries (> ${MAX_ENTRIES} ceiling) — an accidental sweep of node_modules or generated output`,
      });
    }
    if (unpackedSize > MAX_UNPACKED_BYTES) {
      violations.push({
        kind: "bloat",
        detail: `unpacked size ${unpackedSize} bytes (> ${MAX_UNPACKED_BYTES} ceiling)`,
      });
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  return {
    ok: violations.length === 0,
    entryCount: files.length,
    unpackedSize,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    violations,
  };
}

function report(result) {
  if (asJson) {
    console.log(JSON.stringify({ ...result, files: undefined }, null, 2));
    return;
  }
  process.stdout.write(`\nscan-artifact: ${result.entryCount} entries, ${result.unpackedSize} bytes unpacked\n`);
  if (result.ok) {
    process.stdout.write("scan-artifact: OK — packed artifact is clean and slim\n");
    return;
  }
  process.stderr.write(`\nscan-artifact: FAIL — ${result.violations.length} violation(s)\n`);
  for (const violation of result.violations) {
    process.stderr.write(`  [${violation.kind}] ${violation.path ? `${violation.path}: ` : ""}${violation.detail}\n`);
  }
}

if (import.meta.main) {
  const destDir = mkdtempSync(join(tmpdir(), "telephony-artifact-pack-"));
  try {
    const result = scanPackedTarball(packRepo(repoRoot, destDir));
    report(result);
    if (!result.ok) process.exit(1);
  } catch (error) {
    process.stderr.write(`\nscan-artifact: ERROR — ${error?.message ?? error}\n`);
    process.exit(1);
  } finally {
    rmSync(destDir, { recursive: true, force: true });
  }
}
