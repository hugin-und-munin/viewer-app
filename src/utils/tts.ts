// Text-to-speech via Piper (a local neural TTS engine), synthesized in the
// Electron main process and played back here as a WAV blob. Voice selection
// is a plain 'male' | 'female' choice — Piper always uses a specific, known
// model per voice, so (unlike the OS-voice-list approach this replaced)
// there's no guessing which installed system voice sounds male or female.

export type TtsVoice = 'male' | 'female'

export interface TTSOptions {
  rate?: number // 0.1 - 10, default 1 — inverted into Piper's length_scale
  voice?: TtsVoice
  onEnd?: () => void
  onProgress?: (fraction: number) => void // 0..1 playback progress, ~replaces word-boundary events
}

// Piper/espeak-ng mispronounces German "DD. Month" dates (digit + period,
// e.g. "23. Juli") — spell the day out as an ordinal word first. Applied
// centrally here so it covers dates anywhere they show up (clock, routine
// descriptions, chat messages), not just one module.
const GERMAN_MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const ORDINAL_DAY_WORDS: Record<number, string> = {
  1: 'erste', 2: 'zweite', 3: 'dritte', 4: 'vierte', 5: 'fünfte',
  6: 'sechste', 7: 'siebte', 8: 'achte', 9: 'neunte', 10: 'zehnte',
  11: 'elfte', 12: 'zwölfte', 13: 'dreizehnte', 14: 'vierzehnte', 15: 'fünfzehnte',
  16: 'sechzehnte', 17: 'siebzehnte', 18: 'achtzehnte', 19: 'neunzehnte',
}
const CARDINAL_DAY_UNITS: Record<number, string> = {
  1: 'ein', 2: 'zwei', 3: 'drei', 4: 'vier', 5: 'fünf',
  6: 'sechs', 7: 'sieben', 8: 'acht', 9: 'neun',
}

function ordinalDayWord(day: number): string {
  if (day <= 19) return ORDINAL_DAY_WORDS[day] ?? String(day)
  const tensWord = day < 30 ? 'zwanzig' : 'dreißig'
  const unit = day % 10
  return unit === 0 ? `${tensWord}ste` : `${CARDINAL_DAY_UNITS[unit]}und${tensWord}ste`
}

const SPOKEN_DATE_PATTERN = new RegExp(`\\b(\\d{1,2})\\.\\s+(${GERMAN_MONTHS.join('|')})\\b`, 'gi')

function normalizeSpokenDates(text: string): string {
  return text.replace(SPOKEN_DATE_PATTERN, (match, day: string, month: string) => {
    const d = Number(day)
    return d >= 1 && d <= 31 ? `${ordinalDayWord(d)} ${month}` : match
  })
}

let currentAudio: HTMLAudioElement | null = null
let currentAudioUrl: string | null = null
let currentToken = 0

function teardownCurrent(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.onended = null
    currentAudio.onerror = null
    currentAudio.ontimeupdate = null
    currentAudio = null
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl)
    currentAudioUrl = null
  }
}

export function isSpeaking(): boolean {
  return currentAudio !== null && !currentAudio.paused
}

export async function speak(text: string, options: TTSOptions = {}): Promise<void> {
  const token = ++currentToken
  teardownCurrent()

  const voice = options.voice ?? 'female'
  const lengthScale = 1 / (options.rate ?? 1)
  const normalizedText = normalizeSpokenDates(text)

  let base64Wav: string
  try {
    base64Wav = await window.electronAPI!.synthesizeSpeech(normalizedText, voice, lengthScale)
  } catch (err) {
    // A newer speak() or stop() call superseded this one while it was
    // synthesizing — piperTts kills the in-flight process, which rejects
    // here as an expected side effect, not a real failure. The newer call
    // owns onEnd duty now, so stay silent.
    if (token !== currentToken) return
    console.error('[tts] Sprachsynthese fehlgeschlagen:', err)
    options.onEnd?.()
    return
  }
  // A newer speak() or stop() call superseded this one while it was waiting.
  if (token !== currentToken) return

  const bytes = Uint8Array.from(atob(base64Wav), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  const audio = new Audio(url)
  currentAudio = audio
  currentAudioUrl = url

  audio.onended = () => {
    if (currentAudio === audio) teardownCurrent()
    options.onEnd?.()
  }
  audio.onerror = () => {
    console.error('[tts] Audio-Wiedergabe fehlgeschlagen:', audio.error?.code, audio.error?.message)
    if (currentAudio === audio) teardownCurrent()
    options.onEnd?.()
  }
  if (options.onProgress) {
    audio.ontimeupdate = () => {
      if (audio.duration > 0) options.onProgress!(audio.currentTime / audio.duration)
    }
  }

  audio.play().catch(() => {
    if (currentAudio === audio) teardownCurrent()
    options.onEnd?.()
  })
}

export function stop(): void {
  currentToken++
  teardownCurrent()
}
