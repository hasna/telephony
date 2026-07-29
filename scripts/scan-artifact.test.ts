/**
 * Unit coverage for the packed-artifact release gate.
 *
 * `bun scripts/scan-artifact.mjs` reports OK on today's artifact, which on its
 * own is indistinguishable from a scanner that detects nothing. These tests
 * pin that each rule actually fires.
 *
 * Every sample credential is assembled from fragments at runtime so this file
 * does not match itself when the scanner walks the packed artifact — the same
 * technique src/db/no-shared-cloud-contract.test.ts uses.
 */
import { describe, expect, it } from "bun:test";
import { forbiddenReason, inventoryCounts, secretFindings } from "./scan-artifact.mjs";

describe("secretFindings", () => {
  it("flags credential patterns without echoing the value", () => {
    const samples: Array<[string, string]> = [
      ["anthropic-api-key", "sk-" + "ant-" + "api03-" + "A".repeat(20)],
      ["npm-token", "npm_" + "b".repeat(36)],
      ["github-token", "gh" + "p_" + "c".repeat(36)],
      ["aws-access-key-id", "AKIA" + "ABCDEFGHIJKLMNOP"],
      ["google-api-key", "AIza" + "d".repeat(35)],
    ];

    for (const [ruleId, value] of samples) {
      const findings = secretFindings(`const token = "${value}";\n`);
      expect(findings.map((finding) => finding.ruleId)).toContain(ruleId);
      expect(JSON.stringify(findings)).not.toContain(value);
    }
  });

  it("reports the line a credential appears on", () => {
    const content = `line one\nline two\nconst k = "${"AKIA" + "ZZZZZZZZZZZZZZZZ"}";\n`;
    expect(secretFindings(content)).toEqual([{ ruleId: "aws-access-key-id", line: 3 }]);
  });

  it("flags a DSN carrying a real password but not a documentation placeholder", () => {
    const real = secretFindings("postgres" + "://telephony:hunter2hunter2@db.internal:5432/telephony");
    expect(real.map((finding) => finding.ruleId)).toEqual(["postgres-dsn-password"]);

    for (const placeholder of ["pw", "PASSWORD", "<password>", "${PGPASSWORD}"]) {
      expect(secretFindings(`postgres` + `://user:${placeholder}@host:5432/db`)).toEqual([]);
    }
  });

  it("passes clean content", () => {
    expect(secretFindings("export const greeting = \"hello\";\n")).toEqual([]);
  });
});

describe("forbiddenReason", () => {
  it("rejects files that must never ship", () => {
    expect(forbiddenReason("node_modules/pg/index.js")).toContain("node_modules");
    expect(forbiddenReason(".github/workflows/deploy.yml")).toContain(".github");
    expect(forbiddenReason(".git/config")).toContain("VCS");
    expect(forbiddenReason(".hasna/state.json")).toContain("scratch");
    expect(forbiddenReason(".env")).toContain("dotenv");
    expect(forbiddenReason(".env.production")).toContain("dotenv");
  });

  it("allows the shipped set, including inert dotenv templates", () => {
    expect(forbiddenReason("dist/cli/index.js")).toBeNull();
    expect(forbiddenReason("src/db/remote-storage.ts")).toBeNull();
    expect(forbiddenReason(".env.example")).toBeNull();
  });
});

describe("inventoryCounts", () => {
  // Built programmatically: a literal block of 30 URLs in this file would be a
  // bulk inventory the scanner would (correctly) flag in the packed artifact.
  const urls = (count: number, suffix: string) =>
    Array.from({ length: count }, (_, index) => `https://host${index}.${suffix}/path`).join("\n");

  it("counts distinct URL hosts and ignores reserved ones", () => {
    expect(inventoryCounts(urls(30, "operator-fleet.net")).host).toBe(30);
    expect(inventoryCounts(urls(30, "example.com")).host).toBe(0);
    expect(inventoryCounts("http://localhost:8080/health").host).toBe(0);
  });

  it("does not mistake dotted source tokens for hosts", () => {
    expect(inventoryCounts("import { a } from './b.js';\nconfig.server.port = 1;\n").host).toBe(0);
  });

  it("counts public IPv4 addresses only", () => {
    expect(inventoryCounts("203.0.113.7 198.51.100.9").ip).toBe(2);
    expect(inventoryCounts("127.0.0.1 10.0.0.5 192.168.1.4 172.16.0.9 169.254.1.1").ip).toBe(0);
  });

  it("counts distinct email addresses case-insensitively", () => {
    expect(inventoryCounts("Ops@Hasna.com ops@hasna.com sre@hasna.com").email).toBe(2);
  });
});
