import { createVoicemail, listVoicemails, markVoicemailListened } from "../db/voicemails.js";
import { generateSpeech } from "./tts.js";
import { transcribeUrl } from "./stt.js";
import { saveAudio, generateAudioFilename, getAudioDir } from "./audio.js";
import type { Voicemail } from "../types/index.js";
import { join } from "node:path";

export async function setGreeting(options: {
  agent_id: string;
  text: string;
  voice_id?: string;
}): Promise<{ path: string }> {
  const filename = `greeting-${options.agent_id}.mp3`;
  const result = await generateSpeech({
    text: options.text,
    voice_id: options.voice_id,
    output_path: filename,
  });
  return { path: result.path };
}

export function getGreetingPath(agentId: string): string | null {
  const path = join(getAudioDir(), `greeting-${agentId}.mp3`);
  try {
    const { existsSync } = require("node:fs");
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

export async function handleVoicemailRecording(options: {
  call_id?: string;
  from_number: string;
  to_number: string;
  recording_url: string;
  duration?: number;
  agent_id?: string;
  project_id?: string;
}): Promise<Voicemail> {
  // Download recording
  let localPath: string | undefined;
  try {
    const res = await fetch(options.recording_url);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = generateAudioFilename("voicemail");
      localPath = saveAudio(buffer, filename);
    }
  } catch {}

  // Transcribe
  let transcription: string | undefined;
  try {
    const result = await transcribeUrl(options.recording_url);
    transcription = result.text;
  } catch {}

  return createVoicemail({
    call_id: options.call_id,
    from_number: options.from_number,
    to_number: options.to_number,
    recording_url: options.recording_url,
    local_path: localPath,
    transcription,
    duration: options.duration,
    agent_id: options.agent_id,
    project_id: options.project_id,
  });
}
