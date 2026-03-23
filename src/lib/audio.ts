import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const AUDIO_DIR = join(homedir(), ".hasna", "telephony", "audio");

export function getAudioDir(): string {
  mkdirSync(AUDIO_DIR, { recursive: true });
  return AUDIO_DIR;
}

export function saveAudio(buffer: Buffer | Uint8Array, filename: string): string {
  const dir = getAudioDir();
  const path = join(dir, filename);
  writeFileSync(path, buffer);
  return path;
}

export function loadAudio(path: string): Buffer {
  return readFileSync(path);
}

export function encodeBase64(path: string): string {
  return readFileSync(path).toString("base64");
}

export function audioExists(path: string): boolean {
  return existsSync(path);
}

export function generateAudioFilename(prefix: string, extension: string = "mp3"): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${random}.${extension}`;
}
