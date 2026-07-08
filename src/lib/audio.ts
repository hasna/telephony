import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

const AUDIO_DIR = join(homedir(), ".hasna", "telephony", "audio");

export function getAudioDir(): string {
  mkdirSync(AUDIO_DIR, { recursive: true });
  return AUDIO_DIR;
}

export function saveAudio(buffer: Buffer | Uint8Array, filename: string): string {
  // An absolute --out path is honored as-is; a relative one (including one with
  // nested segments like "clips/foo.mp3") is resolved under the audio dir.
  const path = isAbsolute(filename) ? filename : join(getAudioDir(), filename);
  // Create the target's parent directory so nested/out paths don't ENOENT.
  mkdirSync(dirname(path), { recursive: true });
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
