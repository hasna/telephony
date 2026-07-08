import { afterEach, describe, expect, test } from "bun:test";
import { getConfig } from "./config.js";

const TOUCHED = [
  "TWILIO_ACCOUNT_SID",
  "HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "HASNAXYZ_TWILIO_LIVE_AUTH_TOKEN",
  "ELEVENLABS_VOICE_ID",
] as const;

function clear() {
  for (const k of TOUCHED) delete process.env[k];
}

describe("getConfig credential normalization", () => {
  afterEach(clear);

  test("strips literal double quotes wrapping the account SID", () => {
    clear();
    process.env["HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID"] = '"ACabc123"';
    expect(getConfig().twilio_account_sid).toBe("ACabc123");
  });

  test("strips literal single quotes and surrounding whitespace", () => {
    clear();
    process.env["TWILIO_AUTH_TOKEN"] = "  'secrettoken'  ";
    expect(getConfig().twilio_auth_token).toBe("secrettoken");
  });

  test("leaves an unquoted value untouched", () => {
    clear();
    process.env["TWILIO_ACCOUNT_SID"] = "ACplain";
    expect(getConfig().twilio_account_sid).toBe("ACplain");
  });

  test("does not strip a lone leading quote (mismatched)", () => {
    clear();
    process.env["TWILIO_ACCOUNT_SID"] = '"ACnoclose';
    expect(getConfig().twilio_account_sid).toBe('"ACnoclose');
  });

  test("prefers the primary env var over the HASNAXYZ fallback", () => {
    clear();
    process.env["TWILIO_ACCOUNT_SID"] = "ACprimary";
    process.env["HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID"] = "ACfallback";
    expect(getConfig().twilio_account_sid).toBe("ACprimary");
  });

  test("falls back to the default voice id when unset", () => {
    clear();
    expect(getConfig().elevenlabs_voice_id).toBe("21m00Tcm4TlvDq8ikWAM");
  });
});
