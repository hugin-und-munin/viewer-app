const synth = () => window.speechSynthesis;

export interface TTSOptions {
  rate?: number;   // 0.1 - 10, default 1
  pitch?: number;  // 0 - 2, default 1
  volume?: number; // 0 - 1, default 1
  voice?: SpeechSynthesisVoice;
  onEnd?: () => void;
  onBoundary?: (event: SpeechSynthesisEvent) => void;
}

export function speak(text: string, options: TTSOptions = {}): void {
  const s = synth();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate   = options.rate   ?? 1;
  utterance.pitch  = options.pitch  ?? 1;
  utterance.volume = options.volume ?? 1;

  if (options.voice)      utterance.voice      = options.voice;
  if (options.onEnd)      utterance.onend      = options.onEnd;
  if (options.onBoundary) utterance.onboundary = options.onBoundary;

  if (s.speaking) {
    s.cancel();
    // after cancel() — a short delay lets the engine fully reset first
    setTimeout(() => s.speak(utterance), 150);
  } else {
    s.speak(utterance);
  }
}

export function stop(): void {
  synth().cancel();
}

export function getVoices(): SpeechSynthesisVoice[] {
  return synth().getVoices();
}