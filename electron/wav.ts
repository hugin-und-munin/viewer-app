// Minimal WAV (PCM) helpers used to splice silence between separately
// synthesized speech segments. Piper always emits 16-bit PCM in a standard
// RIFF/WAVE container, so parsing only needs to handle that shape.

export interface WavFormat {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

export function parseWav(buf: Buffer): { fmt: WavFormat; data: Buffer } {
  let offset = 12;
  let fmt: WavFormat | null = null;
  let data: Buffer | null = null;

  while (offset < buf.length - 8) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      fmt = {
        numChannels: buf.readUInt16LE(chunkStart + 2),
        sampleRate: buf.readUInt32LE(chunkStart + 4),
        bitsPerSample: buf.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === "data") {
      data = buf.subarray(chunkStart, Math.min(buf.length, chunkStart + chunkSize));
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt || !data) throw new Error("invalid WAV: missing fmt or data chunk");
  return { fmt, data };
}

export function buildWav(fmt: WavFormat, pcmData: Buffer): Buffer {
  const blockAlign = (fmt.numChannels * fmt.bitsPerSample) / 8;
  const byteRate = fmt.sampleRate * blockAlign;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(fmt.numChannels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(fmt.bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

// Zero-valued PCM samples are silence — no need to encode anything.
export function silenceBuffer(fmt: WavFormat, durationMs: number): Buffer {
  const bytesPerSample = fmt.bitsPerSample / 8;
  const numSamples = Math.round((fmt.sampleRate * durationMs) / 1000);
  return Buffer.alloc(numSamples * bytesPerSample * fmt.numChannels);
}

export function pcmDurationSec(data: Buffer, fmt: WavFormat): number {
  const blockAlign = (fmt.numChannels * fmt.bitsPerSample) / 8;
  return data.length / (fmt.sampleRate * blockAlign);
}
