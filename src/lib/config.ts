import type { TelephonyConfig } from "../types/index.js";

/**
 * Read an env var and strip a single pair of matching surrounding quotes.
 *
 * Some fleet machines store credentials with literal wrapping quotes (e.g.
 * `HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID='"ACxxxx"'`), which made the Twilio client
 * reject the SID with "accountSid must start with AC". Normalizing here keeps a
 * quoted credential from breaking every provider call, without ever logging or
 * exposing the value.
 */
function env(...keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw == null || raw === "") continue;
    const trimmed = raw.trim();
    if (trimmed.length >= 2) {
      const first = trimmed[0];
      const last = trimmed[trimmed.length - 1];
      if ((first === '"' || first === "'") && last === first) {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed;
  }
  return undefined;
}

export function getConfig(): TelephonyConfig {
  return {
    twilio_account_sid: env("TWILIO_ACCOUNT_SID", "HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID"),
    twilio_auth_token: env("TWILIO_AUTH_TOKEN", "HASNAXYZ_TWILIO_LIVE_AUTH_TOKEN"),
    twilio_phone_number: env("TWILIO_PHONE_NUMBER", "HASNAXYZ_TWILIO_LIVE_PHONE_NUMBER"),
    elevenlabs_api_key: env("ELEVENLABS_API_KEY", "HASNAXYZ_ELEVENLABS_LIVE_API_KEY"),
    elevenlabs_voice_id: env("ELEVENLABS_VOICE_ID") || "21m00Tcm4TlvDq8ikWAM",
    openai_api_key: env("OPENAI_API_KEY", "HASNAXYZ_OPENAI_LIVE_API_KEY"),
    cerebras_api_key: env("CEREBRAS_API_KEY", "HASNA_CEREBRAS_LIVE_API_KEY"),
    webhook_base_url: env("TELEPHONY_WEBHOOK_URL"),
    server_port: parseInt(process.env["TELEPHONY_PORT"] || "19451", 10),
  };
}

export function requireConfig(key: keyof TelephonyConfig): string {
  const config = getConfig();
  const value = config[key];
  if (!value) {
    throw new Error(`Missing config: ${key}. Set the corresponding environment variable.`);
  }
  return String(value);
}
