import { getConfig } from "./config.js";

/**
 * OpenAI Realtime API voice streaming bridge.
 * Cloud-only feature — requires a server with a public URL for Twilio Media Streams.
 *
 * Architecture:
 *   Twilio (phone call) → Media Stream WebSocket → This bridge → OpenAI Realtime WebSocket
 *
 * The bridge receives audio from Twilio's Media Stream, forwards it to OpenAI Realtime,
 * and sends OpenAI's audio responses back to Twilio.
 */

export interface RealtimeSession {
  id: string;
  callSid: string;
  openaiWs: WebSocket | null;
  twilioWs: WebSocket | null;
  active: boolean;
}

const sessions = new Map<string, RealtimeSession>();

export function isCloudMode(): boolean {
  const config = getConfig();
  return !!config.webhook_base_url;
}

export function createRealtimeSession(callSid: string): RealtimeSession {
  if (!isCloudMode()) {
    throw new Error("OpenAI Realtime streaming requires cloud mode (TELEPHONY_WEBHOOK_URL must be set)");
  }

  const session: RealtimeSession = {
    id: crypto.randomUUID(),
    callSid,
    openaiWs: null,
    twilioWs: null,
    active: true,
  };

  sessions.set(session.id, session);
  return session;
}

export async function connectOpenAI(sessionId: string, options?: {
  model?: string;
  voice?: string;
  instructions?: string;
}): Promise<void> {
  const config = getConfig();
  const apiKey = config.openai_api_key;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for Realtime streaming");

  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const model = options?.model || "gpt-4o-realtime-preview";
  const url = `wss://api.openai.com/v1/realtime?model=${model}`;

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  } as any);

  ws.addEventListener("open", () => {
    // Configure session
    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        turn_detection: { type: "server_vad" },
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        voice: options?.voice || "alloy",
        instructions: options?.instructions || "You are a helpful AI assistant on a phone call. Be concise and conversational.",
        modalities: ["text", "audio"],
        temperature: 0.8,
      },
    }));
  });

  session.openaiWs = ws;
}

export function handleTwilioMediaStream(sessionId: string, twilioWs: WebSocket): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.twilioWs = twilioWs;
  let streamSid: string | null = null;

  twilioWs.addEventListener("message", (event) => {
    const data = JSON.parse(String(event.data));

    switch (data.event) {
      case "start":
        streamSid = data.start.streamSid;
        break;

      case "media":
        // Forward audio from Twilio to OpenAI
        if (session.openaiWs?.readyState === WebSocket.OPEN) {
          session.openaiWs.send(JSON.stringify({
            type: "input_audio_buffer.append",
            audio: data.media.payload,
          }));
        }
        break;

      case "stop":
        closeSession(sessionId);
        break;
    }
  });

  // Forward OpenAI audio to Twilio
  if (session.openaiWs) {
    session.openaiWs.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data));

      if (data.type === "response.audio.delta" && data.delta) {
        if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
          twilioWs.send(JSON.stringify({
            event: "media",
            streamSid,
            media: { payload: data.delta },
          }));
        }
      }
    });
  }
}

export function closeSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.active = false;
  try { session.openaiWs?.close(); } catch {}
  try { session.twilioWs?.close(); } catch {}
  sessions.delete(sessionId);
}

export function getSession(sessionId: string): RealtimeSession | undefined {
  return sessions.get(sessionId);
}

export function listSessions(): RealtimeSession[] {
  return Array.from(sessions.values());
}

export function generateRealtimeTwiml(websocketUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you to the AI assistant.</Say>
  <Connect>
    <Stream url="${websocketUrl}" />
  </Connect>
</Response>`;
}
