// Shared timing tables for module speech — used by Chat, Routine, and Time
// so "Lesegeschwindigkeit"/"Sprechpause" mean the same thing (and produce the
// same actual durations) everywhere they appear.

// Maps the "Lesegeschwindigkeit" (readingSpeed) setting to Piper's rate
// option (inverted into length_scale by tts.ts).
export const READING_RATE: Record<string, number> = { slow: 0.5, normal: 0.7, fast: 1 }

// Two pause scales, both driven by the same "Sprechpause" (pause) setting:
// short pauses sit *within* one announcement (e.g. greeting → intro, title →
// description), long pauses sit *between* separate things (module start,
// between messages, between repeats) — a pause between two distinct items
// should read as more of a break than a pause mid-thought.
export const SHORT_PAUSE_MS: Record<string, number> = { short: 1000, medium: 2000, long: 4000 }
export const LONG_PAUSE_MS: Record<string, number> = { short: 3000, medium: 6000, long: 10000 }
