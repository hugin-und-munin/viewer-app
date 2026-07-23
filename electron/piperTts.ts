import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import log from "electron-log/main";

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

// Only one utterance should ever be synthesizing at a time — e.g. React
// StrictMode's dev-mode double-invoke can fire a module's speak effect twice
// in quick succession. Without this, two piper processes could run
// concurrently and (depending on how the renderer reacts to two in-flight
// requests) risk overlapping audio. Tracking and killing the previous
// process makes "only one at a time" true at the source, not just something
// the renderer has to get right on its own.
let activeProc: ChildProcess | null = null;

export async function synthesizeSpeech(
  text: string,
  voice: PiperVoice,
  lengthScale: number,
): Promise<Buffer> {
  const exe = process.env.PIPER_EXE || DEFAULT_EXE;
  const model = modelPathFor(voice);
  // Piper treats each line of stdin as a separate utterance and emits one
  // WAV per line. Chat messages can contain literal newlines (multi-line
  // input); with a single output file that silently left only the last
  // line's audio behind. Collapse to a single line so piper only ever
  // synthesizes (and writes) one utterance.
  const singleLineText = text.replace(/\r?\n+/g, " ").trim();

  if (activeProc) {
    activeProc.kill();
    activeProc = null;
  }

  const tmpFile = path.join(os.tmpdir(), `piper-${randomUUID()}.wav`);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(exe, [
        "--model", model,
        "--output_file", tmpFile,
        "--length_scale", String(lengthScale),
      ]);
      activeProc = proc;

      let stderr = "";
      proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on("error", (err) => {
        if (activeProc === proc) activeProc = null;
        reject(new Error(`piper could not be started (${exe}): ${err.message}`));
      });

      proc.on("close", (code) => {
        if (activeProc === proc) activeProc = null;
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

    const wav = await fs.readFile(tmpFile);
    attenuateWavInPlace(wav, HEADROOM_GAIN);
    return wav;
  } finally {
    fs.unlink(tmpFile).catch(() => {});
  }
}

export async function synthesizeSpeechBase64(
  text: string,
  voice: PiperVoice,
  lengthScale: number,
): Promise<string> {
  try {
    const wav = await synthesizeSpeech(text, voice, lengthScale);
    return wav.toString("base64");
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "piper synthesis superseded") {
      log.error("[tts] synthesis failed:", err);
    }
    throw err;
  }
}
