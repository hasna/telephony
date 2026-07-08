import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAudioDir, saveAudio } from "./audio.js";

// Regression coverage for the `tts --out` ENOENT crash: a relative out path with
// nested segments (or an absolute path) used to fail because the parent dir was
// never created. saveAudio must mkdir the parent and honor absolute paths.
// NOTE: the audio dir is derived from homedir() at module load, so these assert
// on returned paths + existence and clean up whatever they create.

const created: string[] = [];

afterEach(() => {
  for (const p of created.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe("saveAudio", () => {
  it("creates nested parent dirs for a relative out path", () => {
    const rel = "audio-test-clips/nested/deep/foo.mp3";
    created.push(join(getAudioDir(), "audio-test-clips"));
    const p = saveAudio(Buffer.from("abc"), rel);
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p).toString()).toBe("abc");
    expect(p.endsWith(join("nested", "deep", "foo.mp3"))).toBe(true);
  });

  it("honors an absolute out path as-is", () => {
    const root = mkdtempSync(join(tmpdir(), "telephony-audio-"));
    created.push(root);
    const abs = join(root, "elsewhere", "bar.mp3");
    const p = saveAudio(Buffer.from("xyz"), abs);
    expect(p).toBe(abs);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).toString()).toBe("xyz");
  });

  it("still writes a bare filename under the audio dir", () => {
    const p = saveAudio(Buffer.from("q"), "audio-test-flat.mp3");
    created.push(p);
    expect(existsSync(p)).toBe(true);
    expect(p.endsWith(join("telephony", "audio", "audio-test-flat.mp3"))).toBe(true);
  });
});
