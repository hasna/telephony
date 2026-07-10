import { getTwilioClient } from "./twilio.js";
import { getStore } from "./store/index.js";
import type { AvailableNumber, SearchAvailableOptions, TwilioNumberRef } from "./store/index.js";
import type { PhoneNumber, PhoneNumberCapability } from "../types/index.js";

export type { AvailableNumber, TwilioNumberRef } from "./store/index.js";

// Twilio provider passthrough is routed through the Store so it obeys the
// 3-mode standard: cloud/self_hosted mode goes through the server-side `/v1`
// proxy (credential stays on the server), local mode calls Twilio directly.
export async function searchAvailableNumbers(options: SearchAvailableOptions): Promise<AvailableNumber[]> {
  return getStore().searchAvailableNumbers(options);
}

export async function provisionNumber(options: {
  phone_number: string;
  agent_id?: string;
  project_id?: string;
  friendly_name?: string;
  sms_url?: string;
  voice_url?: string;
}): Promise<PhoneNumber> {
  const client = getTwilioClient();

  const params: Record<string, unknown> = {
    phoneNumber: options.phone_number,
  };
  if (options.friendly_name) params.friendlyName = options.friendly_name;
  if (options.sms_url) params.smsUrl = options.sms_url;
  if (options.voice_url) params.voiceUrl = options.voice_url;

  const incoming = await client.incomingPhoneNumbers.create(params);

  const capabilities: PhoneNumberCapability[] = [];
  if (incoming.capabilities.voice) capabilities.push("voice");
  if (incoming.capabilities.sms) capabilities.push("sms");
  if (incoming.capabilities.mms) capabilities.push("mms");

  return getStore().createPhoneNumber({
    number: incoming.phoneNumber,
    country: (incoming as any).isoCountry || "US",
    capabilities,
    agent_id: options.agent_id,
    project_id: options.project_id,
    twilio_sid: incoming.sid,
    friendly_name: incoming.friendlyName,
  });
}

export async function releaseNumber(numberOrId: string): Promise<boolean> {
  const store = getStore();
  const client = getTwilioClient();

  const record = await store.getPhoneNumberByNumber(numberOrId);
  const sid = record?.twilio_sid;

  if (sid) {
    await client.incomingPhoneNumbers(sid).remove();
  }

  if (record) {
    await store.releasePhoneNumber(record.id);
  }

  return true;
}

export async function configureNumber(sid: string, options: {
  sms_url?: string;
  voice_url?: string;
  friendly_name?: string;
  status_callback?: string;
}): Promise<void> {
  const client = getTwilioClient();
  const params: Record<string, string> = {};
  if (options.sms_url) params.smsUrl = options.sms_url;
  if (options.voice_url) params.voiceUrl = options.voice_url;
  if (options.friendly_name) params.friendlyName = options.friendly_name;
  if (options.status_callback) params.statusCallback = options.status_callback;

  await client.incomingPhoneNumbers(sid).update(params);
}

export async function listTwilioNumbers(): Promise<TwilioNumberRef[]> {
  return getStore().listTwilioNumbers();
}
