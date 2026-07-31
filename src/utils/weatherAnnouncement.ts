// Pure logic for turning raw Open-Meteo values into German phrases and an
// asset category — shared by the spoken announcement and the on-screen
// image selection so both always agree on "what the weather currently is".

export type WeatherAssetCategory =
  | 'sonnig'
  | 'klar-nacht'
  | 'teilweise-bewoelkt'
  | 'teilweise-bewoelkt-nacht'
  | 'bedeckt'
  | 'nebel'
  | 'regen-leicht'
  | 'regen-stark'
  | 'gewitter'
  | 'schnee'

// WMO weather codes (https://open-meteo.com/en/docs) → the asset category
// used to pick an icon/photo file. Coarser than the spoken phrase below —
// e.g. light and heavy rain share one image but are worded differently.
//
// Only the two categories that actually depict the sun (sonnig,
// teilweise-bewoelkt) have a night variant — everything else (bedeckt,
// nebel, regen-leicht, regen-stark, gewitter, schnee) has no sun in the
// artwork to begin with, so the same image already reads fine day or night.
export function weatherAssetCategory(code: number, isDay: boolean): WeatherAssetCategory {
  if (code === 0) return isDay ? 'sonnig' : 'klar-nacht'
  if (code === 1 || code === 2) return isDay ? 'teilweise-bewoelkt' : 'teilweise-bewoelkt-nacht'
  if (code === 3) return 'bedeckt'
  if (code === 45 || code === 48) return 'nebel'
  // Same slight-vs-rest severity split as the spoken phrase below, so the
  // icon and the words always agree on "how bad is it".
  if ([51, 61, 80].includes(code)) return 'regen-leicht'
  if ([53, 55, 56, 57, 63, 65, 66, 67, 81, 82].includes(code)) return 'regen-stark'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'schnee'
  if (code === 95 || code === 96 || code === 99) return 'gewitter'
  return 'bedeckt'
}

// Same codes, but worded for speech — finer-grained than the asset category
// (e.g. "leichter" vs "starker" Regen share one image, not one phrase).
export function weatherConditionPhrase(code: number): string {
  if (code === 0) return 'klarer Himmel'
  if (code === 1) return 'überwiegend klar'
  if (code === 2) return 'leicht bewölkt'
  if (code === 3) return 'bedeckt'
  if (code === 45 || code === 48) return 'Nebel'
  // Bucketed by WMO's own "slight" vs "moderate/heavy/dense/violent" severity —
  // e.g. code 80 is explicitly "rain showers: slight", so it belongs with the
  // light bucket even though it's a shower rather than steady rain.
  if ([51, 61, 80].includes(code)) return 'leichter Regen'
  if ([53, 55, 63, 65, 81, 82].includes(code)) return 'starker Regen'
  // Freezing drizzle/rain (56/57/66/67) — ice hazard, called out explicitly
  // rather than folded into the plain rain buckets above.
  if (code === 56 || code === 57) return 'gefrierender Sprühregen'
  if (code === 66 || code === 67) return 'gefrierender Regen'
  if ([71, 77, 85].includes(code)) return 'leichter Schnee'
  if ([73, 75, 86].includes(code)) return 'starker Schnee'
  if (code === 95) return 'Gewitter'
  if (code === 96 || code === 99) return 'Gewitter mit Hagel'
  return 'wechselhaftes Wetter'
}

// Thresholds are a judgement call, not a standard — tuned so e.g. 32°C
// reads as "sehr heiss", not merely "heiss".
export function temperatureTerm(celsius: number): string {
  if (celsius < 0) return 'sehr kalt'
  if (celsius < 8) return 'kalt'
  if (celsius < 15) return 'kühl'
  if (celsius < 21) return 'mild'
  if (celsius < 28) return 'warm'
  if (celsius < 32) return 'heiss'
  return 'sehr heiss'
}

// Wind is a separate axis from the weather code (a continuous km/h value,
// not part of the WMO condition), combined with it in speech rather than
// replacing it — e.g. "windig und teilweise bewölkt".
export function windModifier(windKmh: number): string | undefined {
  if (windKmh >= 40) return 'stürmisch'
  if (windKmh >= 20) return 'windig'
  return undefined
}

// Plain "Es ist Nachmittag/Abend/..." is deliberately NOT covered here —
// that's what the Time/Routine module is for. This only speaks up for the
// sun's own position, which is weather-specific: a ~1h "bald" lead-in, then
// a ±20 min window centred on the actual sunrise/sunset moment. Outside
// those windows there is nothing to say, so callers should skip this
// segment entirely when it returns undefined.
export function sunPositionPhrase(now: Date, sunrise: Date, sunset: Date): string | undefined {
  const plusMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60000)
  const t = now.getTime()

  if (t >= plusMinutes(sunrise, -60).getTime() && t < plusMinutes(sunrise, -20).getTime()) {
    return 'Die Sonne geht bald auf.'
  }
  if (t >= plusMinutes(sunrise, -20).getTime() && t < plusMinutes(sunrise, 20).getTime()) {
    return 'Die Sonne geht auf.'
  }
  if (t >= plusMinutes(sunset, -60).getTime() && t < plusMinutes(sunset, -20).getTime()) {
    return 'Die Sonne geht bald unter.'
  }
  if (t >= plusMinutes(sunset, -20).getTime() && t < plusMinutes(sunset, 20).getTime()) {
    return 'Die Sonne geht unter.'
  }
  return undefined
}
