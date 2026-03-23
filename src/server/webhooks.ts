import { handleInboundSms } from "../lib/sms.js";
import { handleInboundWhatsApp } from "../lib/whatsapp.js";
import { handleInboundCall } from "../lib/voice.js";
import { handleVoicemailRecording } from "../lib/voicemail.js";
import { updateCallStatus } from "../db/calls.js";
import { updateMessageStatus } from "../db/messages.js";
import { dispatchWebhook } from "../db/webhooks.js";

export function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, val] = pair.split("=");
    if (key && val !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(val.replace(/\+/g, " "));
    }
  }
  return params;
}

export async function handleSmsWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const msg = handleInboundSms({
    MessageSid: params.MessageSid || "",
    From: params.From || "",
    To: params.To || "",
    Body: params.Body || "",
    NumMedia: params.NumMedia,
    MediaUrl0: params.MediaUrl0,
  });

  await dispatchWebhook("sms.inbound", msg);

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export async function handleWhatsAppWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const msg = handleInboundWhatsApp({
    MessageSid: params.MessageSid || "",
    From: params.From || "",
    To: params.To || "",
    Body: params.Body || "",
    NumMedia: params.NumMedia,
    MediaUrl0: params.MediaUrl0,
    MediaContentType0: params.MediaContentType0,
  });

  await dispatchWebhook("whatsapp.inbound", msg);

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export async function handleVoiceWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const call = handleInboundCall({
    CallSid: params.CallSid || "",
    From: params.From || "",
    To: params.To || "",
    CallStatus: params.CallStatus || "",
    Direction: params.Direction || "",
  });

  await dispatchWebhook("call.inbound", call);

  // Default: play greeting and record voicemail
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>You've reached the AI assistant. Please leave a message after the beep.</Say>
  <Record maxLength="120" transcribe="true" action="/webhooks/voicemail/recording" />
</Response>`;
}

export async function handleVoicemailRecordingWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);
  const voicemail = await handleVoicemailRecording({
    call_id: params.CallSid,
    from_number: params.From || "",
    to_number: params.To || "",
    recording_url: params.RecordingUrl || "",
    duration: parseInt(params.RecordingDuration || "0"),
  });

  await dispatchWebhook("voicemail.new", voicemail);

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Goodbye.</Say></Response>`;
}

export async function handleStatusWebhook(body: string): Promise<string> {
  const params = parseFormBody(body);

  // Message status update
  if (params.MessageSid && params.MessageStatus) {
    const statusMap: Record<string, string> = {
      queued: "queued", sent: "sent", delivered: "delivered", failed: "failed",
      undelivered: "failed", read: "read",
    };
    const status = statusMap[params.MessageStatus] || params.MessageStatus;
    // We'd need to look up by twilio_sid — simplified here
    await dispatchWebhook("message.status", { sid: params.MessageSid, status });
  }

  // Call status update
  if (params.CallSid && params.CallStatus) {
    await dispatchWebhook("call.status", { sid: params.CallSid, status: params.CallStatus });
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
