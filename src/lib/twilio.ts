import Twilio from "twilio";
import { getConfig, requireConfig } from "./config.js";

let _client: ReturnType<typeof Twilio> | null = null;

export function getTwilioClient(): ReturnType<typeof Twilio> {
  if (_client) return _client;
  const sid = requireConfig("twilio_account_sid");
  const token = requireConfig("twilio_auth_token");
  _client = Twilio(sid, token);
  return _client;
}

export function getDefaultPhoneNumber(): string {
  return requireConfig("twilio_phone_number");
}

export function hasTwilioConfig(): boolean {
  const config = getConfig();
  return !!(config.twilio_account_sid && config.twilio_auth_token);
}
