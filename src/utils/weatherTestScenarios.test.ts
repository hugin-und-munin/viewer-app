import { describe, it, expect } from 'vitest'
import { WEATHER_TEST_SCENARIOS, buildTestWeatherData } from './weatherTestScenarios'
import {
  weatherAssetCategory,
  sunPositionPhrase,
  temperatureTerm,
  windModifier,
  type WeatherAssetCategory,
} from './weatherAnnouncement'

// Every category the icon/photo lookup tables (Weather.tsx) must have an
// entry for — if this list and that lookup table ever drift apart, that's a
// runtime crash, not just a missing test case.
const ALL_CATEGORIES: WeatherAssetCategory[] = [
  'sonnig',
  'klar-nacht',
  'teilweise-bewoelkt',
  'teilweise-bewoelkt-nacht',
  'bedeckt',
  'bedeckt-nacht',
  'nebel',
  'regen-leicht',
  'regen-stark',
  'gewitter',
  'gewitter-nacht',
  'schnee',
  'schnee-nacht',
]

// Fixed reference date — sunrise/sunset/announcementNow are all computed
// relative to "today" in buildTestWeatherData, so a fixed base date keeps
// this deterministic regardless of when the test suite runs.
const BASE_DATE = new Date(2026, 0, 1)

describe('WEATHER_TEST_SCENARIOS coverage', () => {
  it('covers every icon/photo asset category at least once', () => {
    const covered = new Set(
      WEATHER_TEST_SCENARIOS.map((s) => weatherAssetCategory(s.weatherCode, s.isDay)),
    )
    for (const category of ALL_CATEGORIES) {
      expect(covered.has(category), `no scenario produces category "${category}"`).toBe(true)
    }
  })

  it('covers all four sun-position announcement windows', () => {
    const phrases = new Set(
      WEATHER_TEST_SCENARIOS.map((s) => {
        const data = buildTestWeatherData(s, BASE_DATE)
        return sunPositionPhrase(data.announcementNow, data.sunrise, data.sunset)
      }),
    )
    for (const expected of [
      'Die Sonne geht bald auf.',
      'Die Sonne geht auf.',
      'Die Sonne geht bald unter.',
      'Die Sonne geht unter.',
    ]) {
      expect(phrases.has(expected), `no scenario triggers "${expected}"`).toBe(true)
    }
  })

  it('covers the "no sun-position phrase" case for both day and night', () => {
    const results = WEATHER_TEST_SCENARIOS.map((s) => {
      const data = buildTestWeatherData(s, BASE_DATE)
      return {
        isDay: s.isDay,
        phrase: sunPositionPhrase(data.announcementNow, data.sunrise, data.sunset),
      }
    })
    expect(
      results.some((r) => r.isDay && r.phrase === undefined),
      'no daytime scenario falls outside every sun-position window',
    ).toBe(true)
    expect(
      results.some((r) => !r.isDay && r.phrase === undefined),
      'no night-time scenario falls outside every sun-position window',
    ).toBe(true)
  })

  it('covers all 7 temperature terms', () => {
    const covered = new Set(WEATHER_TEST_SCENARIOS.map((s) => temperatureTerm(s.temperature)))
    for (const term of ['sehr kalt', 'kalt', 'kühl', 'mild', 'warm', 'heiss', 'sehr heiss']) {
      expect(covered.has(term), `no scenario produces temperature term "${term}"`).toBe(true)
    }
  })

  it('covers both wind modifiers', () => {
    const covered = new Set(WEATHER_TEST_SCENARIOS.map((s) => windModifier(s.windKmh)))
    expect(covered.has('windig'), 'no scenario triggers "windig"').toBe(true)
    expect(covered.has('stürmisch'), 'no scenario triggers "stürmisch"').toBe(true)
  })

  it('includes a tomorrow-forecast scenario', () => {
    expect(WEATHER_TEST_SCENARIOS.some((s) => s.tomorrow !== undefined)).toBe(true)
  })
})
