import { requireConfig, getConfig } from "./config.js";
import { saveAudio, generateAudioFilename } from "./audio.js";
import { getStore } from "./store/index.js";

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
}

/** True when this process has an ElevenLabs credential configured. */
export function hasElevenLabsConfig(): boolean {
  return !!getConfig().elevenlabs_api_key;
}

/**
 * Raw ElevenLabs voices fetch using THIS process's credential. Used by the
 * LocalStore (local machine calls ElevenLabs directly) and by the cloud
 * server's `/v1/voices` proxy (server credential from Secrets Manager). Clients
 * in cloud mode never call this — they route through {@link listVoices}.
 */
export async function fetchVoicesFromProvider(): Promise<Voice[]> {
  const apiKey = requireConfig("elevenlabs_api_key");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });

  if (!res.ok) throw new Error(`ElevenLabs API error: ${res.status} ${await res.text()}`);

  const data = await res.json() as { voices: Array<{ voice_id: string; name: string; category: string; description: string }> };
  return data.voices.map(v => ({
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    description: v.description || "",
  }));
}

// ElevenLabs voices passthrough is routed through the Store so it obeys the
// 3-mode standard (parity with `searchAvailableNumbers`/`listTwilioNumbers`):
// cloud/self_hosted mode goes through the server-side `/v1/voices` proxy
// (credential stays on the server), local mode calls ElevenLabs directly.
export async function listVoices(): Promise<Voice[]> {
  return getStore().listVoices();
}

export async function generateSpeech(options: {
  text: string;
  voice_id?: string;
  model_id?: string;
  output_format?: string;
  output_path?: string;
}): Promise<{ path: string; size: number }> {
  const apiKey = requireConfig("elevenlabs_api_key");
  const config = getConfig();
  const voiceId = options.voice_id || config.elevenlabs_voice_id || "21m00Tcm4TlvDq8ikWAM";
  const modelId = options.model_id || "eleven_multilingual_v2";

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: options.text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!res.ok) throw new Error(`ElevenLabs TTS error: ${res.status} ${await res.text()}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const filename = options.output_path || generateAudioFilename("tts");
  const path = saveAudio(buffer, filename);

  return { path, size: buffer.length };
}
