// Synthetic weather states for visually testing the Weather module (icons
// AND real photos) without waiting for real weather/time to change. Cycles
// through a curated list covering every asset category (day and night
// variants alike), all 7 temperature terms, both wind modifiers, every
// sun-position announcement window (plus the "no phrase" case), freezing
// precipitation, and the "morgen" forecast — one new state per module load
// (see nextTestScenario below). Coverage is enforced by
// weatherTestScenarios.test.ts, not just this comment — if a case here goes
// missing, that test fails.

export interface WeatherTestScenario {
  label: string
  nowTime: [hours: number, minutes: number]
  sunriseTime: [hours: number, minutes: number]
  sunsetTime: [hours: number, minutes: number]
  temperature: number
  weatherCode: number
  isDay: boolean
  windKmh: number
  tomorrow?: { weatherCode: number; maxTemp: number }
}

const SUNRISE: [number, number] = [7, 0]
const SUNSET: [number, number] = [19, 0]

export const WEATHER_TEST_SCENARIOS: WeatherTestScenario[] = [
  {
    label: 'Sonne geht bald auf, sehr kalt, klarer Himmel',
    nowTime: [6, 15],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: -5,
    weatherCode: 0,
    isDay: false,
    windKmh: 5,
  },
  {
    label: 'Sonnenaufgang, kalt, leicht bewölkt',
    nowTime: [7, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 3,
    weatherCode: 1,
    isDay: true,
    windKmh: 10,
  },
  {
    label: 'Vormittag, kühl, bedeckt',
    nowTime: [9, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 10,
    weatherCode: 3,
    isDay: true,
    windKmh: 8,
  },
  {
    label: 'Vormittag, mild, leichter Regen',
    nowTime: [10, 15],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 16,
    weatherCode: 61,
    isDay: true,
    windKmh: 12,
  },
  {
    label: 'Vormittag, kalt, gefrierender Regen',
    nowTime: [8, 45],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 1,
    weatherCode: 66,
    isDay: true,
    windKmh: 15,
  },
  {
    label: 'Mittag, mild, sonnig',
    nowTime: [12, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 18,
    weatherCode: 0,
    isDay: true,
    windKmh: 5,
  },
  {
    label: 'Nachmittag, warm, leicht bewölkt, windig',
    nowTime: [14, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 24,
    weatherCode: 2,
    isDay: true,
    windKmh: 25,
  },
  {
    label: 'Nachmittag, heiss, sonnig — mit Morgen-Ansage',
    nowTime: [15, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 30,
    weatherCode: 0,
    isDay: true,
    windKmh: 8,
    tomorrow: { weatherCode: 65, maxTemp: 14 },
  },
  {
    label: 'Nachmittag, sehr heiss, Gewitter, stürmisch',
    nowTime: [16, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 33,
    weatherCode: 95,
    isDay: true,
    windKmh: 45,
  },
  {
    label: 'Nachmittag, kühl, starker Regen',
    nowTime: [13, 45],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 12,
    weatherCode: 65,
    isDay: true,
    windKmh: 18,
  },
  {
    label: 'Vormittag, sehr kalt, leichter Schnee',
    nowTime: [9, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: -3,
    weatherCode: 71,
    isDay: true,
    windKmh: 6,
  },
  {
    label: 'Vormittag, sehr kalt, starker Schnee',
    nowTime: [11, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: -8,
    weatherCode: 75,
    isDay: true,
    windKmh: 20,
  },
  {
    label: 'Vormittag, kühl, Nebel',
    nowTime: [8, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 6,
    weatherCode: 45,
    isDay: true,
    windKmh: 3,
  },
  {
    label: 'Sonne geht bald unter, warm, sonnig',
    nowTime: [18, 15],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 22,
    weatherCode: 0,
    isDay: true,
    windKmh: 10,
  },
  {
    label: 'Sonnenuntergang, mild, teilweise bewölkt',
    nowTime: [19, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 17,
    weatherCode: 1,
    isDay: false,
    windKmh: 14,
  },
  {
    label: 'Nacht, kalt, klarer Himmel',
    nowTime: [22, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 2,
    weatherCode: 0,
    isDay: false,
    windKmh: 4,
  },
  {
    label: 'Nacht, mild, teilweise bewölkt',
    nowTime: [23, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 14,
    weatherCode: 2,
    isDay: false,
    windKmh: 9,
  },
  {
    label: 'Nacht, kühl, bedeckt',
    nowTime: [1, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 9,
    weatherCode: 3,
    isDay: false,
    windKmh: 7,
  },
  {
    label: 'Vormittag, kalt, gefrierender Regen (leichter Sprühregen)',
    nowTime: [9, 15],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 0,
    weatherCode: 56,
    isDay: true,
    windKmh: 11,
  },
  {
    label: 'Nacht, mild, leichter Regen',
    nowTime: [21, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 13,
    weatherCode: 61,
    isDay: false,
    windKmh: 13,
  },
  {
    label: 'Nacht, kühl, starker Regen',
    nowTime: [2, 30],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 11,
    weatherCode: 65,
    isDay: false,
    windKmh: 16,
  },
  {
    label: 'Nacht, warm, Gewitter, stürmisch',
    nowTime: [23, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: 21,
    weatherCode: 95,
    isDay: false,
    windKmh: 42,
  },
  {
    label: 'Nacht, sehr kalt, Schnee',
    nowTime: [4, 0],
    sunriseTime: SUNRISE,
    sunsetTime: SUNSET,
    temperature: -6,
    weatherCode: 73,
    isDay: false,
    windKmh: 17,
  },
]

function timeToday(base: Date, [hours, minutes]: [number, number]): Date {
  const d = new Date(base)
  d.setHours(hours, minutes, 0, 0)
  return d
}

export interface WeatherTestData {
  temperature: number
  weatherCode: number
  isDay: boolean
  windKmh: number
  sunrise: Date
  sunset: Date
  tomorrow?: { weatherCode: number; maxTemp: number }
  announcementNow: Date
}

export function buildTestWeatherData(
  scenario: WeatherTestScenario,
  base: Date = new Date(),
): WeatherTestData {
  return {
    temperature: scenario.temperature,
    weatherCode: scenario.weatherCode,
    isDay: scenario.isDay,
    windKmh: scenario.windKmh,
    sunrise: timeToday(base, scenario.sunriseTime),
    sunset: timeToday(base, scenario.sunsetTime),
    tomorrow: scenario.tomorrow,
    announcementNow: timeToday(base, scenario.nowTime),
  }
}

// Module-scope cursor — persists across component remounts within the same
// running app (each loadModule command mounts a fresh Weather instance, see
// moduleDisplayManager's instanceId/key), so every reload steps to the next
// scenario instead of always showing the first one.
let cursor = 0

export function nextTestScenario(): WeatherTestScenario {
  const scenario = WEATHER_TEST_SCENARIOS[cursor % WEATHER_TEST_SCENARIOS.length]
  cursor += 1
  return scenario
}
