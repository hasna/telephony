import { requireConfig } from "./config.js";
import { readFileSync } from "node:fs";

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export async function transcribe(audioFilePath: string): Promise<TranscriptionResult> {
  const apiKey = requireConfig("elevenlabs_api_key");
  const audioData = readFileSync(audioFilePath);

  const formData = new FormData();
  const ext = audioFilePath.split(".").pop() || "mp3";
  const mimeType = ext === "wav" ? "audio/wav" : ext === "ogg" ? "audio/ogg" : "audio/mpeg";
  formData.append("file", new Blob([audioData], { type: mimeType }), `audio.${ext}`);
  formData.append("model", "scribe_v1");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!res.ok) throw new Error(`ElevenLabs STT error: ${res.status} ${await res.text()}`);

  const data = await res.json() as { text: string; language_code?: string; duration?: number };
  return {
    text: data.text,
    language: data.language_code,
    duration: data.duration,
  };
}

export async function transcribeUrl(url: string): Promise<TranscriptionResult> {
  const apiKey = requireConfig("elevenlabs_api_key");

  // Download audio first
  const audioRes = await fetch(url);
  if (!audioRes.ok) throw new Error(`Failed to download audio from ${url}`);
  const audioData = Buffer.from(await audioRes.arrayBuffer());

  const formData = new FormData();
  formData.append("file", new Blob([audioData], { type: "audio/mpeg" }), "audio.mp3");
  formData.append("model", "scribe_v1");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!res.ok) throw new Error(`ElevenLabs STT error: ${res.status} ${await res.text()}`);

  const data = await res.json() as { text: string; language_code?: string; duration?: number };
  return { text: data.text, language: data.language_code, duration: data.duration };
}
