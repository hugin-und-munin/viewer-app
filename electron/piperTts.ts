import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import log from "electron-log/main";
import { parseWav, buildWav, silenceBuffer, pcmDurationSec } from "./wav";

// Runs Piper (https://github.com/rhasspy/piper), a local neural TTS engine,
// as a one-shot child process per utterance. Piper writes the WAV to a real
// temp file rather than being captured from stdout (`--output_file -`) —
// stdout capture produced audible noise in testing on this machine, while
// file output has consistently been clean.
//
// Paths default to the standard install location (see piper.md on the dev's
// desktop) but can be overridden via env vars for other machines.

const DEFAULT_EXE = "C:\\Program Files\\Piper\\piper\\piper.exe";
const DEFAULT_MODEL_MALE = "C:\\Program Files\\Piper\\piper\\de_DE-thorsten-high.onnx";
const DEFAULT_MODEL_FEMALE = "C:\\Program Files\\Piper\\piper\\de_DE-kerstin-low.onnx";

// Piper's raw output routinely peaks at exactly 0 dBFS. With no headroom,
// the renderer's automatic resample-to-device-rate step (e.g. 16kHz piper
// audio played on a 48kHz output device) overshoots past full scale and
// hard-clips — audible as heavy noise/distortion. Verified empirically
// against a real recording: -6dB removes clipping entirely (0.00%, was
// 1.55% post-resample) while staying comfortably audible.
const HEADROOM_GAIN = 0.5; // -6dB

// Piper has no SSML/pause syntax for this CLI usage, so a requested pause is
// built by synthesizing each side separately and splicing real silence
// between them. Two markers: PAUSE_MARKER uses the caller-supplied pauseMs
// (the module's short/medium/long setting), PAUSE_SHORT_MARKER is always a
// fixed short gap regardless of that setting (e.g. appointment → its own
// description — related enough that it shouldn't scale with the "long" option).
// Both must match the PAUSE/PAUSE_SHORT constants in src/utils/tts.ts exactly —
// Invisible Separator / Invisible Times so they can never collide with real
// typed text.
const PAUSE_MARKER = "⁣";
const PAUSE_SHORT_MARKER = "⁢";
const SHORT_PAUSE_MS = 500;

export type PiperVoice = "male" | "female";

function modelPathFor(voice: PiperVoice): string {
  return voice === "male"
    ? process.env.PIPER_MODEL_MALE || DEFAULT_MODEL_MALE
    : process.env.PIPER_MODEL_FEMALE || DEFAULT_MODEL_FEMALE;
}

// Scales the 16-bit PCM samples in a WAV buffer's 'data' chunk in place.
// Minimal parsing — just enough to locate that one chunk.
function attenuateWavInPlace(buf: Buffer, gain: number): void {
  let offset = 12;
  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const dataStart = offset + 8;
      const dataEnd = Math.min(buf.length, dataStart + chunkSize);
      for (let i = dataStart; i + 1 < dataEnd; i += 2) {
        const sample = buf.readInt16LE(i);
        const scaled = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
        buf.writeInt16LE(scaled, i);
      }
      return;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
}

// Only one utterance (which may now involve several piper processes, one per
// paused segment) should ever be synthesizing at a time — e.g. React
// StrictMode's dev-mode double-invoke can fire a module's speak effect twice
// in quick succession. A new request kills everything still tracked here
// before starting; each killed process's 'close' handler rejects with
// "piper synthesis superseded", which propagates out through the older
// call's Promise.all/await — no separate generation counter needed.
let activeProcs: ChildProcess[] = [];

function killActive(): void {
  for (const p of activeProcs) p.kill();
  activeProcs = [];
}

async function synthesizeOneSegment(
  text: string,
  exe: string,
  model: string,
  lengthScale: number,
): Promise<Buffer> {
  // Piper treats each line of stdin as a separate utterance and emits one
  // WAV per line. Collapse to a single line so it only ever synthesizes (and
  // writes) one utterance for this segment.
  const singleLineText = text.replace(/\r?\n+/g, " ").trim();
  const tmpFile = path.join(os.tmpdir(), `piper-${randomUUID()}.wav`);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(exe, [
        "--model", model,
        "--output_file", tmpFile,
        "--length_scale", String(lengthScale),
      ]);
      activeProcs.push(proc);

      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("error", (err) => {
        activeProcs = activeProcs.filter((p) => p !== proc);
        reject(new Error(`piper could not be started (${exe}): ${err.message}`));
      });

      proc.on("close", (code) => {
        activeProcs = activeProcs.filter((p) => p !== proc);
        if (code === null) {
          // Killed (superseded by a newer request) — reject quietly, no error log.
          reject(new Error("piper synthesis superseded"));
          return;
        }
        if (code !== 0) {
          reject(new Error(`piper exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        resolve();
      });

      proc.stdin.write(singleLineText, "utf-8");
      proc.stdin.end();
    });

    return await fs.readFile(tmpFile);
  } finally {
    fs.unlink(tmpFile).catch(() => {});
  }
}

interface Segment {
  text: string;
  // Silence to splice in after this segment; 0 for the last segment or when
  // no pause was requested at that point.
  pauseAfterMs: number;
}

function splitIntoSegments(text: string, pauseMs: number): Segment[] {
  const parts = text.split(new RegExp(`(${PAUSE_MARKER}|${PAUSE_SHORT_MARKER})`));
  const segments: Segment[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i].trim();
    if (!t) continue;
    const marker = parts[i + 1];
    const pauseAfterMs =
      marker === PAUSE_SHORT_MARKER ? SHORT_PAUSE_MS : marker === PAUSE_MARKER ? pauseMs : 0;
    segments.push({ text: t, pauseAfterMs });
  }
  return segments;
}

export interface SynthesisResult {
  wav: Buffer;
  // Seconds into the final clip where each PAUSE/PAUSE_SHORT-separated
  // segment begins (index 0 is always 0) — lets a caller that concatenated
  // several pieces of text (e.g. Chat's "Nachricht von X." + message body)
  // find exactly where its own segment starts speaking, instead of
  // estimating it from character counts. Only meaningful when segments were
  // actually spliced with real silence; an unspliced clip reports a single
  // [0] since no per-segment boundary was ever measured.
  segmentStartsSec: number[];
}

export async function synthesizeSpeech(
  text: string,
  voice: PiperVoice,
  lengthScale: number,
  pauseMs = 0,
): Promise<SynthesisResult> {
  const exe = process.env.PIPER_EXE || DEFAULT_EXE;
  const model = modelPathFor(voice);
  const segments = splitIntoSegments(text, pauseMs);

  killActive();

  const needsSplicing = segments.length > 1 && segments.some((s) => s.pauseAfterMs > 0);
  if (!needsSplicing) {
    const joined = segments.map((s) => s.text).join(" ") || text;
    const wav = await synthesizeOneSegment(joined, exe, model, lengthScale);
    attenuateWavInPlace(wav, HEADROOM_GAIN);
    return { wav, segmentStartsSec: [0] };
  }

  // Synthesize every segment in parallel — much lower total latency than
  // sequential spawns, and correctness doesn't depend on ordering since each
  // segment's position in the final audio comes from its array index, not
  // from completion order.
  const wavs = await Promise.all(
    segments.map((seg) => synthesizeOneSegment(seg.text, exe, model, lengthScale)),
  );

  const parsed = wavs.map(parseWav);
  const fmt = parsed[0].fmt;

  const pieces: Buffer[] = [];
  const segmentStartsSec: number[] = [];
  let elapsedSec = 0;
  parsed.forEach((p, i) => {
    segmentStartsSec.push(elapsedSec);
    pieces.push(p.data);
    elapsedSec += pcmDurationSec(p.data, fmt);
    const gapMs = segments[i].pauseAfterMs;
    if (i < parsed.length - 1 && gapMs > 0) {
      pieces.push(silenceBuffer(fmt, gapMs));
      elapsedSec += gapMs / 1000;
    }
  });

  const combined = buildWav(fmt, Buffer.concat(pieces));
  attenuateWavInPlace(combined, HEADROOM_GAIN);
  return { wav: combined, segmentStartsSec };
}

export async function synthesizeSpeechBase64(
  text: string,
  voice: PiperVoice,
  lengthScale: number,
  pauseMs = 0,
): Promise<{ base64: string; segmentStartsSec: number[] }> {
  try {
    const { wav, segmentStartsSec } = await synthesizeSpeech(text, voice, lengthScale, pauseMs);
    return { base64: wav.toString("base64"), segmentStartsSec };
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "piper synthesis superseded") {
      log.error("[tts] synthesis failed:", err);
    }
    throw err;
  }
}
