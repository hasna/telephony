/**
 * Merge gate for hasna.contract.json.
 *
 * The manifest is a published file (package.json `files[]` ships it), so what
 * it claims about telephony is what operators and fleet tooling act on. Before
 * this suite existed nothing in the repo read it, and a manifest that failed
 * `contracts repo-conformance` could ship with a fully green test run.
 *
 * Two layers, deliberately:
 *   1. structural assertions that run everywhere, with no external tool — they
 *      pin the specific claims that must stay true (both storage engines, no
 *      storage waiver, a live-PG gate wired to a real test, a packed-artifact
 *      scan reachable from prepack);
 *   2. the real `contracts repo-conformance` run when the CLI is installed,
 *      asserting ok:true so no check can regress unnoticed.
 *
 * Layer 1 exists because layer 2 cannot run without the globally installed
 * `contracts` binary; a gate that silently skips is the hole this closes.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "hasna.contract.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const scripts: Record<string, string> = pkg.scripts ?? {};

/** Package scripts reachable from `entry`, following `bun run <script>` edges. */
function reachableScripts(entry: string): Set<string> {
  const reached = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    if (reached.has(name) || !(name in scripts)) continue;
    reached.add(name);
    for (const match of scripts[name].matchAll(/\b(?:bun|bunx|npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/g)) {
      queue.push(match[1] as string);
    }
  }
  return reached;
}

describe("hasna.contract.json", () => {
  it("declares both storage engines the repo actually ships", () => {
    // src/db/sqlite-adapter.ts and src/db/remote-storage.ts + the vendored
    // storage kit are both shipped code paths; the manifest must say so.
    expect(manifest.storage.engines).toEqual(["sqlite", "postgres"]);
  });

  it("claims no storage-engine waiver", () => {
    // A waiver here would assert telephony has not adopted PostgreSQL, which
    // src/db/remote-storage.ts and scripts/apply-cloud-migrations.mjs refute.
    // The 0.8.x validator also rejects storage waivers for a service-capable
    // cli-with-store repo shipping telephony-serve.
    expect(manifest.metadata?.conformance?.waivedStorageEngines ?? []).toEqual([]);
  });

  it("wires the live-PostgreSQL gate to a test that reads the declared env var", () => {
    const gate = manifest.storage.pgTestGate;
    expect(gate?.envVar).toBe("HASNA_TELEPHONY_TEST_DATABASE_URL");

    const script = gate.command.replace(/^bun run /, "");
    expect(scripts[script]).toBeDefined();

    const testFile = scripts[script].replace(/^bun test /, "");
    expect(existsSync(join(repoRoot, testFile))).toBe(true);
    expect(readFileSync(join(repoRoot, testFile), "utf8")).toContain(gate.envVar);
  });

  it("binds the packed-artifact scan into prepack", () => {
    const script = manifest.metadata?.release?.artifactScan?.script;
    expect(script).toBeDefined();
    expect(scripts[script]).toBeDefined();
    expect(reachableScripts("prepack").has(script)).toBe(true);
  });

  it("declares the bins package.json actually exposes", () => {
    expect(manifest.bins.slice().sort()).toEqual(Object.keys(pkg.bin).sort());
  });
});

const contractsCli = Bun.which("contracts");

describe.skipIf(!contractsCli)("contracts repo-conformance", () => {
  it("returns ok:true with no failing check", async () => {
    const proc = Bun.spawn([contractsCli as string, "repo-conformance", "--json"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const report = JSON.parse(stdout) as {
      ok: boolean;
      checks: Array<{ id: string; status: string; detail: string }>;
    };
    const notPassing = report.checks.filter((check) => check.status !== "pass" && check.status !== "skip");

    expect(notPassing.map((check) => `${check.id}: ${check.detail}`)).toEqual([]);
    expect(report.ok).toBe(true);
  });
});
