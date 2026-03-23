import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { createPhoneNumber, releasePhoneNumberDb, deletePhoneNumber, getPhoneNumberByNumber } from "../db/phone-numbers.js";
import type { PhoneNumber, PhoneNumberCapability } from "../types/index.js";

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
}

export async function searchAvailableNumbers(options: {
  country?: string;
  area_code?: string;
  contains?: string;
  sms_enabled?: boolean;
  voice_enabled?: boolean;
  limit?: number;
}): Promise<AvailableNumber[]> {
  const client = getTwilioClient();
  const country = options.country || "US";
  const limit = options.limit || 10;

  const params: Record<string, unknown> = { limit };
  if (options.area_code) params.areaCode = parseInt(options.area_code, 10);
  if (options.contains) params.contains = options.contains;
  if (options.sms_enabled !== undefined) params.smsEnabled = options.sms_enabled;
  if (options.voice_enabled !== undefined) params.voiceEnabled = options.voice_enabled;

  const numbers = await client.availablePhoneNumbers(country).local.list(params);

  return numbers.map(n => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality,
    region: n.region,
    capabilities: { voice: n.capabilities.voice, sms: n.capabilities.sms, mms: n.capabilities.mms },
  }));
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

  return createPhoneNumber({
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
  const client = getTwilioClient();

  const record = getPhoneNumberByNumber(numberOrId);
  const sid = record?.twilio_sid;

  if (sid) {
    await client.incomingPhoneNumbers(sid).remove();
  }

  if (record) {
    releasePhoneNumberDb(record.id);
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

export async function listTwilioNumbers(): Promise<Array<{ sid: string; phoneNumber: string; friendlyName: string }>> {
  const client = getTwilioClient();
  const numbers = await client.incomingPhoneNumbers.list({ limit: 100 });
  return numbers.map(n => ({ sid: n.sid, phoneNumber: n.phoneNumber, friendlyName: n.friendlyName }));
}
