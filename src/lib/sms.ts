import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { createMessage, updateMessageStatus } from "../db/messages.js";
import type { Message } from "../types/index.js";

export async function sendSms(options: {
  to: string;
  body: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
  status_callback?: string;
}): Promise<Message> {
  const client = getTwilioClient();
  const from = options.from || getDefaultPhoneNumber();

  // Create DB record first
  const msg = createMessage({
    type: "sms_outbound",
    from_number: from,
    to_number: options.to,
    body: options.body,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const params: Record<string, string> = {
      to: options.to,
      from,
      body: options.body,
    };
    if (options.status_callback) params.statusCallback = options.status_callback;

    const twilioMsg = await client.messages.create(params as any);

    updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export interface InboundSmsPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
}

export function handleInboundSms(payload: InboundSmsPayload, agentId?: string, projectId?: string): Message {
  return createMessage({
    type: "sms_inbound",
    from_number: payload.From,
    to_number: payload.To,
    body: payload.Body,
    media_url: payload.MediaUrl0 || undefined,
    status: "received",
    agent_id: agentId,
    project_id: projectId,
    twilio_sid: payload.MessageSid,
  });
}
