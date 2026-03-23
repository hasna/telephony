import { requireConfig, getConfig } from "./config.js";
import { saveAudio, generateAudioFilename } from "./audio.js";

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  description: string;
}

export async function listVoices(): Promise<Voice[]> {
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
