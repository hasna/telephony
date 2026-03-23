import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { createCall, updateCallStatus } from "../db/calls.js";
import type { Call } from "../types/index.js";

export async function makeCall(options: {
  to: string;
  from?: string;
  twiml?: string;
  url?: string;
  agent_id?: string;
  project_id?: string;
  status_callback?: string;
  record?: boolean;
}): Promise<Call> {
  const client = getTwilioClient();
  const from = options.from || getDefaultPhoneNumber();

  const call = createCall({
    direction: "outbound",
    from_number: from,
    to_number: options.to,
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const params: Record<string, unknown> = {
      to: options.to,
      from,
    };

    if (options.twiml) {
      params.twiml = options.twiml;
    } else if (options.url) {
      params.url = options.url;
    } else {
      // Default: simple dial TwiML
      params.twiml = `<Response><Say>Connecting you now.</Say><Dial>${options.to}</Dial></Response>`;
    }

    if (options.status_callback) params.statusCallback = options.status_callback;
    if (options.record) params.record = true;

    const twilioCall = await client.calls.create(params as any);
    updateCallStatus(call.id, "ringing");

    return { ...call, status: "ringing", twilio_sid: twilioCall.sid };
  } catch (err: any) {
    updateCallStatus(call.id, "failed");
    return { ...call, status: "failed" };
  }
}

export async function endCall(twilioSid: string): Promise<void> {
  const client = getTwilioClient();
  await client.calls(twilioSid).update({ status: "completed" });
}

export async function getCallStatus(twilioSid: string): Promise<{ status: string; duration: string | null }> {
  const client = getTwilioClient();
  const call = await client.calls(twilioSid).fetch();
  return { status: call.status, duration: call.duration };
}

export interface InboundCallPayload {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
  Direction: string;
}

export function handleInboundCall(payload: InboundCallPayload, agentId?: string, projectId?: string): Call {
  return createCall({
    direction: "inbound",
    from_number: payload.From,
    to_number: payload.To,
    agent_id: agentId,
    project_id: projectId,
    twilio_sid: payload.CallSid,
  });
}

export function generateTwiml(options: {
  say?: string;
  play?: string;
  dial?: string;
  record?: boolean;
  voicemail_url?: string;
}): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>"];

  if (options.say) parts.push(`  <Say>${escapeXml(options.say)}</Say>`);
  if (options.play) parts.push(`  <Play>${escapeXml(options.play)}</Play>`);
  if (options.dial) parts.push(`  <Dial>${escapeXml(options.dial)}</Dial>`);
  if (options.record) parts.push(`  <Record maxLength="120" transcribe="true" />`);
  if (options.voicemail_url) {
    parts.push(`  <Say>Please leave a message after the beep.</Say>`);
    parts.push(`  <Record maxLength="120" action="${escapeXml(options.voicemail_url)}" />`);
  }

  parts.push("</Response>");
  return parts.join("\n");
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
