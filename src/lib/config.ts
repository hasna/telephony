import type { TelephonyConfig } from "../types/index.js";

export function getConfig(): TelephonyConfig {
  return {
    twilio_account_sid: process.env["TWILIO_ACCOUNT_SID"] || process.env["HASNAXYZ_TWILIO_LIVE_ACCOUNT_SID"],
    twilio_auth_token: process.env["TWILIO_AUTH_TOKEN"] || process.env["HASNAXYZ_TWILIO_LIVE_AUTH_TOKEN"],
    twilio_phone_number: process.env["TWILIO_PHONE_NUMBER"] || process.env["HASNAXYZ_TWILIO_LIVE_PHONE_NUMBER"],
    elevenlabs_api_key: process.env["ELEVENLABS_API_KEY"] || process.env["HASNAXYZ_ELEVENLABS_LIVE_API_KEY"],
    elevenlabs_voice_id: process.env["ELEVENLABS_VOICE_ID"] || "21m00Tcm4TlvDq8ikWAM",
    openai_api_key: process.env["OPENAI_API_KEY"] || process.env["HASNAXYZ_OPENAI_LIVE_API_KEY"],
    cerebras_api_key: process.env["CEREBRAS_API_KEY"] || process.env["HASNA_CEREBRAS_LIVE_API_KEY"],
    webhook_base_url: process.env["TELEPHONY_WEBHOOK_URL"],
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
