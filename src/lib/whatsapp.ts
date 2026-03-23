import { getTwilioClient, getDefaultPhoneNumber } from "./twilio.js";
import { createMessage, updateMessageStatus } from "../db/messages.js";
import type { Message } from "../types/index.js";

function whatsappNumber(number: string): string {
  if (number.startsWith("whatsapp:")) return number;
  return `whatsapp:${number}`;
}

export async function sendWhatsApp(options: {
  to: string;
  body: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
}): Promise<Message> {
  const client = getTwilioClient();
  const from = whatsappNumber(options.from || getDefaultPhoneNumber());
  const to = whatsappNumber(options.to);

  const msg = createMessage({
    type: "whatsapp_outbound",
    from_number: from,
    to_number: to,
    body: options.body,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const twilioMsg = await client.messages.create({ to, from, body: options.body });
    updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export async function sendWhatsAppAudio(options: {
  to: string;
  media_url: string;
  body?: string;
  from?: string;
  agent_id?: string;
  project_id?: string;
}): Promise<Message> {
  const client = getTwilioClient();
  const from = whatsappNumber(options.from || getDefaultPhoneNumber());
  const to = whatsappNumber(options.to);

  const msg = createMessage({
    type: "whatsapp_outbound",
    from_number: from,
    to_number: to,
    body: options.body || "",
    media_url: options.media_url,
    status: "queued",
    agent_id: options.agent_id,
    project_id: options.project_id,
  });

  try {
    const twilioMsg = await client.messages.create({
      to,
      from,
      body: options.body || "",
      mediaUrl: [options.media_url],
    });
    updateMessageStatus(msg.id, "sent");
    return { ...msg, status: "sent", twilio_sid: twilioMsg.sid };
  } catch (err: any) {
    updateMessageStatus(msg.id, "failed", err.message);
    return { ...msg, status: "failed", error_message: err.message };
  }
}

export interface InboundWhatsAppPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  MediaUrl0?: string;
  MediaContentType0?: string;
}

export function handleInboundWhatsApp(payload: InboundWhatsAppPayload, agentId?: string, projectId?: string): Message {
  return createMessage({
    type: "whatsapp_inbound",
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
