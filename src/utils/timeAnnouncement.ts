// Shared spoken time-of-day helpers — used by Time (Uhr) and Routine so
// "natural" vs "exact" time announcements sound the same wherever they show up.

// German hour words 1-12. Natural spoken German time always uses the
// 12-hour cycle regardless of whether the module's own display is 12h or
// 24h — "Uhrentyp"/"Zeitformat" only affects the visual clock face.
const HOUR_WORDS: Record<number, string> = {
  1: 'eins',
  2: 'zwei',
  3: 'drei',
  4: 'vier',
  5: 'fünf',
  6: 'sechs',
  7: 'sieben',
  8: 'acht',
  9: 'neun',
  10: 'zehn',
  11: 'elf',
  12: 'zwölf',
}

function hourWord(n: number): string {
  return HOUR_WORDS[n] ?? String(n)
}

function to12Hour(h: number): number {
  return h % 12 === 0 ? 12 : h % 12
}

export function roundToNearest5Minutes(date: Date): Date {
  const ms = 5 * 60 * 1000
  return new Date(Math.round(date.getTime() / ms) * ms)
}

// Natural German time phrasing, always in 12h form (e.g. "Viertel nach
// zehn", "fünf vor eins", "halb drei"). Covers all twelve 5-minute marks;
// falls back to a plain "H Uhr M" digit form for any other minute (e.g. a
// real appointment time that doesn't happen to land on one) — callers that
// want the full natural phrasing should round first (roundToNearest5Minutes).
export function naturalTimePhrase(date: Date): string {
  const h = date.getHours()
  const m = date.getMinutes()
  const h12 = to12Hour(h)
  const nextH12 = to12Hour(h + 1)

  switch (m) {
    case 0:
      return `${hourWord(h12)} Uhr`
    case 5:
      return `fünf nach ${hourWord(h12)}`
    case 10:
      return `zehn nach ${hourWord(h12)}`
    case 15:
      return `Viertel nach ${hourWord(h12)}`
    case 20:
      return `zwanzig nach ${hourWord(h12)}`
    case 25:
      return `fünfundzwanzig nach ${hourWord(h12)}`
    case 30:
      return `halb ${hourWord(nextH12)}`
    case 35:
      return `fünfundzwanzig vor ${hourWord(nextH12)}`
    case 40:
      return `zwanzig vor ${hourWord(nextH12)}`
    case 45:
      return `Viertel vor ${hourWord(nextH12)}`
    case 50:
      return `zehn vor ${hourWord(nextH12)}`
    case 55:
      return `fünf vor ${hourWord(nextH12)}`
    default:
      return `${hourWord(h12)} Uhr ${m}`
  }
}

// Exact/precise time announcement — always 24h digits, so it stays
// unambiguous regardless of the module's own 12h/24h display setting (no
// "morgens/abends" disambiguation needed, same convention as German train
// announcements and news broadcasts use for precise times).
export function exactTimePhrase(date: Date): string {
  return `${date.getHours()} Uhr ${date.getMinutes()}`
}
