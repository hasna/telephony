import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDbPath } from "./database.js";

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalHasnaDbPath = process.env.HASNA_TELEPHONY_DB_PATH;
const originalTelephonyDbPath = process.env.TELEPHONY_DB_PATH;
const originalScope = process.env.TELEPHONY_DB_SCOPE;
const originalCwd = process.cwd();

let tempRoot: string | undefined;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (originalHasnaDbPath === undefined) delete process.env.HASNA_TELEPHONY_DB_PATH;
  else process.env.HASNA_TELEPHONY_DB_PATH = originalHasnaDbPath;
  if (originalTelephonyDbPath === undefined) delete process.env.TELEPHONY_DB_PATH;
  else process.env.TELEPHONY_DB_PATH = originalTelephonyDbPath;
  if (originalScope === undefined) delete process.env.TELEPHONY_DB_SCOPE;
  else process.env.TELEPHONY_DB_SCOPE = originalScope;
  process.chdir(originalCwd);

  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("getDbPath", () => {
  it("copies legacy home ~/.telephony state into ~/.hasna/telephony", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-db-test-"));
    const home = join(tempRoot, "home");
    const cwd = join(tempRoot, "cwd");
    const legacyDir = join(home, ".telephony");
    const newDir = join(home, ".hasna", "telephony");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(legacyDir, "telephony.db"), "legacy-db");
    writeFileSync(join(legacyDir, "config.json"), "{\"voice\":\"on\"}");

    process.env.HOME = home;
    delete process.env.USERPROFILE;
    delete process.env.HASNA_TELEPHONY_DB_PATH;
    delete process.env.TELEPHONY_DB_PATH;
    delete process.env.TELEPHONY_DB_SCOPE;
    process.chdir(cwd);

    expect(getDbPath()).toBe(join(newDir, "telephony.db"));
    expect(readFileSync(join(newDir, "telephony.db"), "utf8")).toBe("legacy-db");
    expect(readFileSync(join(newDir, "config.json"), "utf8")).toContain("voice");
    expect(existsSync(join(legacyDir, "telephony.db"))).toBe(true);
  });
});
