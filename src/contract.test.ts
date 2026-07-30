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
 *   2. the real `contracts repo-conformance` run, asserting ok:true so no check
 *      can regress unnoticed, against the exact kit version the manifest
 *      declares in `kitVersion`.
 *
 * Layer 1 exists because layer 2 cannot run without the `contracts` binary; a
 * gate that silently skips is the hole this closes.
 *
 * The `@hasna/contracts` dependency is pinned rather than ranged on purpose:
 * 0.8.4 is the newest kit whose checks this repo actually satisfies. 0.8.5 adds
 * `credential_seam_compliance`, which requires importing the client credential
 * seam (`transport.ts` / `storage.ts`) from `@hasna/contracts/client` instead of
 * the vendored copy in `src/generated/storage-client/`. Un-vendoring that seam
 * changes how a CLI opens and authenticates a server connection, so it is a
 * behavioural migration tracked separately, not a dependency bump. Bump the pin
 * and `kitVersion` together when that lands — the version assertion below makes
 * bumping one without the other fail loudly.
 *
 * The mode enum is NOT part of that deferral: `storage-client/mode.ts` re-exports
 * `@hasna/contracts/mode`, so the vocabulary the CLI accepts cannot drift from
 * the vocabulary the manifest declares. That drift is what this suite's
 * kit-lockstep test below now pins on the server side too.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_VERSION, STORAGE_MODES, normalizeStorageMode } from "./generated/storage-kit/index.js";
import { normalizeStorageMode as normalizeClientStorageMode } from "./generated/storage-client/index.js";

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

/**
 * The manifest advertises a configuration; the shipped bins have to accept it.
 *
 * These once disagreed. The manifest was migrated to the `sqlite | postgres`
 * data-backend switch while the vendored kit and client still spoke the removed
 * `local | cloud | self_hosted` placement vocabulary, so every value the manifest
 * sanctioned was a hard startup error (`telephony-serve` and `telephony` both
 * answered "Unknown storage mode: sqlite") and the only value that booted was one
 * the pinned validator rejects. hasna.contract.json ships in package.json
 * `files[]`, so that mismatch was a published false claim, not an internal
 * inconsistency.
 *
 * These assertions read the runtime enums, not a copy of them, so re-opening the
 * gap fails here rather than in an operator's terminal.
 */
describe("declared storage backends match the shipped runtime", () => {
  const kitManifest = JSON.parse(
    readFileSync(join(repoRoot, "src/generated/storage-kit/.storage-kit-manifest.json"), "utf8"),
  );

  it("stamps the on-disk kit at the version the manifest declares", () => {
    // The generator writes both the manifest file and the KIT_VERSION constant;
    // a stale vendored kit is exactly how the runtime kept the removed mode enum
    // while `kitVersion` advertised a kit that had dropped it.
    expect(kitManifest.kitVersion).toBe(manifest.kitVersion);
    expect(KIT_VERSION).toBe(manifest.kitVersion);
  });

  it("resolves every engine the manifest declares, on the server and the client", () => {
    expect(manifest.storage.engines).toEqual([...STORAGE_MODES]);
    for (const engine of manifest.storage.engines as string[]) {
      expect(normalizeStorageMode(engine).mode).toBe(engine);
      expect(normalizeClientStorageMode(engine).mode).toBe(engine);
    }
  });

  it("resolves the default backend the manifest declares", () => {
    expect(normalizeStorageMode(manifest.storage.mode).mode).toBe(manifest.storage.mode);
    expect(normalizeClientStorageMode(manifest.storage.mode).mode).toBe(manifest.storage.mode);
  });

  it("rejects the removed placement vocabulary on the server and the client", () => {
    for (const removed of ["local", "cloud", "self_hosted", "remote", "hybrid"]) {
      expect(() => normalizeStorageMode(removed)).toThrow(/Unknown storage mode/);
      expect(() => normalizeClientStorageMode(removed)).toThrow(/Unknown storage mode/);
    }
  });
});

/**
 * Resolve the conformance validator deterministically.
 *
 * `Bun.which` reads PATH, and only `bun run <script>` prepends
 * `node_modules/.bin` to it. So `bun run test` graded the manifest with the
 * version the lockfile pins while a bare `bun test` graded it with whatever
 * `contracts` happened to be installed globally — two different schemas, two
 * different verdicts, from the same commit. Prefer the workspace binary, and
 * fall back to PATH only when dependencies are not installed.
 */
function resolveContractsCli(): string | null {
  const workspaceBin = join(repoRoot, "node_modules", ".bin", "contracts");
  return existsSync(workspaceBin) ? workspaceBin : Bun.which("contracts");
}

const contractsCli = resolveContractsCli();

/**
 * Keys the mode_enum_compliance check reads out of the ambient process
 * environment. They describe the operator's shell, not this repo, so a
 * developer exporting one must not change the verdict of a repo merge gate —
 * that is the same ambient-state dependence this file exists to remove. Every
 * other check reads the repo and stays inherited.
 */
const AMBIENT_MODE_ENV_KEYS = ["HASNA_TELEPHONY_STORAGE_MODE", "TELEPHONY_STORAGE_MODE"] as const;

function repoGradingEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of AMBIENT_MODE_ENV_KEYS) delete env[key];
  return env;
}

async function runContracts(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn([contractsCli as string, ...args], {
    cwd: repoRoot,
    env: repoGradingEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe.skipIf(!contractsCli)("contracts repo-conformance", () => {
  it("runs the contract kit version the manifest declares it tracks", async () => {
    // A validator other than kitVersion grades the manifest against a schema it
    // was not written against. Fail on the mismatch here, so bumping the
    // dependency without reconciling the manifest is a loud error rather than a
    // silently different verdict below.
    expect((await runContracts(["--version"])).stdout.trim()).toBe(manifest.kitVersion);
  });

  it("vendors the storage kit the generator would emit (no stale or hand-edited copy)", async () => {
    // The structural test above pins the stamped version; this one pins the file
    // contents. A hand edit that re-adds a removed mode keeps the version stamp
    // intact, so only the generator's own check catches it.
    const { stdout, exitCode } = await runContracts(["vendor-kit", "--check", "--json"]);
    const report = JSON.parse(stdout) as {
      ok: boolean;
      version: string;
      staleVersion: string | null;
      files: Array<{ file: string; status: string }>;
      extras: string[];
    };
    expect(report.files.filter((f) => f.status !== "ok")).toEqual([]);
    expect(report.extras).toEqual([]);
    expect(report.staleVersion).toBeNull();
    expect(report.version).toBe(manifest.kitVersion);
    expect(report.ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  it("returns ok:true with no failing check", async () => {
    const proc = Bun.spawn([contractsCli as string, "repo-conformance", "--json"], {
      cwd: repoRoot,
      env: repoGradingEnv(),
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
