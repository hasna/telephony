import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDatabase } from "./database.js";
import { createWebhook, getWebhook, listWebhookDispatchTargets, listWebhooks } from "./webhooks.js";

let tempRoot: string | undefined;

afterEach(() => {
  closeDatabase();
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  }
});

describe("webhook secret redaction", () => {
  it("does not expose signing secrets from public create/get/list results", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-webhooks-test-"));
    const db = getDatabase(join(tempRoot, "telephony.db"));

    const created = createWebhook(
      { url: "https://example.com/hook", events: ["sms.inbound"], secret: "synthetic-signing-secret" },
      db,
    );
    expect(created).toMatchObject({ secret_configured: true });
    expect("secret" in created).toBe(false);

    const got = getWebhook(created.id, db)!;
    expect(got).toMatchObject({ secret_configured: true });
    expect("secret" in got).toBe(false);

    const listed = listWebhooks(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ secret_configured: true });
    expect("secret" in listed[0]!).toBe(false);
  });

  it("keeps signing secrets available only to internal dispatch targets", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "telephony-webhooks-test-"));
    const db = getDatabase(join(tempRoot, "telephony.db"));

    createWebhook({ url: "https://example.com/hook", secret: "synthetic-signing-secret" }, db);

    const targets = listWebhookDispatchTargets(db);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.secret).toBe("synthetic-signing-secret");
    expect(targets[0]!.secret_configured).toBe(true);
  });
});
