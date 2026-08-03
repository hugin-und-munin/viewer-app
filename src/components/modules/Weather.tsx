import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { speak, stop, isSpeaking, PAUSE, type TtsVoice } from '../../utils/tts'
import type { WeatherProps } from '../../types/modules'
import { READING_RATE, SHORT_PAUSE_MS, LONG_PAUSE_MS } from '../../utils/ttsPacing'
import {
  weatherAssetCategory,
  weatherConditionSentence,
  weatherConditionSentenceTomorrow,
  temperatureTerm,
  windModifier,
  sunPositionPhrase,
  type WeatherAssetCategory,
} from '../../utils/weatherAnnouncement'
import { buildTestWeatherData, nextTestScenario } from '../../utils/weatherTestScenarios'

import iconSonnig from '../../assets/weather/sonnig.svg'
import iconKlarNacht from '../../assets/weather/klar-nacht.svg'
import iconTeilweiseBewoelkt from '../../assets/weather/teilweise-bewoelkt.svg'
import iconTeilweiseBewoelktNacht from '../../assets/weather/teilweise-bewoelkt-nacht.svg'
import iconBedeckt from '../../assets/weather/bedeckt.svg'
import iconNebel from '../../assets/weather/nebel.svg'
import iconRegenLeicht from '../../assets/weather/regen-leicht.svg'
import iconRegenStark from '../../assets/weather/regen-stark.svg'
import iconGewitter from '../../assets/weather/gewitter.svg'
import iconSchnee from '../../assets/weather/schnee.svg'

// Real photos, all supplied by the family. teilweise-bewoelkt-nacht has no
// dedicated photo of its own — it reuses the plain "bewölkt" one, which is
// close enough (there's no sun in either shot to give away day vs night).
import photoSonnig from '../../assets/weather-photos/klar-sonne.jpeg'
import photoKlarNacht from '../../assets/weather-photos/nacht-klar.jpeg'
import photoTeilweiseBewoelkt from '../../assets/weather-photos/leicht-bewoelkt.jpeg'
import photoBedeckt from '../../assets/weather-photos/bewoelkt.jpeg'
import photoBedecktNacht from '../../assets/weather-photos/nacht-bedeckt.jpeg'
import photoNebel from '../../assets/weather-photos/nebel.jpeg'
import photoRegen from '../../assets/weather-photos/regen.jpeg'
import photoGewitter from '../../assets/weather-photos/gewitter-tag.jpeg'
import photoGewitterNacht from '../../assets/weather-photos/gewitter-nacht.jpg'
import photoSchnee from '../../assets/weather-photos/schnee-tag.jpeg'
import photoSchneeNacht from '../../assets/weather-photos/schnee-nacht.jpg'

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Atkinson Hyperlegible', sans-serif"

// Solothurn city centre — the module's default location until a family
// member sets a different one in content-app.
const DEFAULT_LATITUDE = 47.2088
const DEFAULT_LONGITUDE = 7.5323

// No dedicated night icons for anything below — none of these have a sun
// in the artwork to begin with, so the same line-drawing already reads
// fine day or night (unlike the real photos, which do get a night shot).
const ICONS: Record<WeatherAssetCategory, string> = {
  sonnig: iconSonnig,
  'klar-nacht': iconKlarNacht,
  'teilweise-bewoelkt': iconTeilweiseBewoelkt,
  'teilweise-bewoelkt-nacht': iconTeilweiseBewoelktNacht,
  bedeckt: iconBedeckt,
  'bedeckt-nacht': iconBedeckt,
  nebel: iconNebel,
  'regen-leicht': iconRegenLeicht,
  'regen-stark': iconRegenStark,
  gewitter: iconGewitter,
  'gewitter-nacht': iconGewitter,
  schnee: iconSchnee,
  'schnee-nacht': iconSchnee,
}

// Real photos throughout. regen-leicht/regen-stark share one photo, day
// and night alike — only one rain photo was supplied, not one per
// intensity or time of day. teilweise-bewoelkt-nacht has no dedicated photo
// either — falls back to the NIGHT overcast shot (not the day one), since
// a bright daytime photo showing at 22:00 reads as flatly wrong, whereas a
// dark overcast-looking night sky is a reasonable stand-in for a partly
// cloudy one.
const PHOTOS: Record<WeatherAssetCategory, string> = {
  sonnig: photoSonnig,
  'klar-nacht': photoKlarNacht,
  'teilweise-bewoelkt': photoTeilweiseBewoelkt,
  'teilweise-bewoelkt-nacht': photoBedecktNacht,
  bedeckt: photoBedeckt,
  'bedeckt-nacht': photoBedecktNacht,
  nebel: photoNebel,
  'regen-leicht': photoRegen,
  'regen-stark': photoRegen,
  gewitter: photoGewitter,
  'gewitter-nacht': photoGewitterNacht,
  schnee: photoSchnee,
  'schnee-nacht': photoSchneeNacht,
}

// ─── Colours ──────────────────────────────────────────────────────────────────

// No separate *user-selectable* light/dark theme here on purpose — the
// background colour itself IS the day/night signal (see weatherBackground
// below), and a manual dark-mode toggle would fight with that (a dark
// screen could then mean either "dark mode" or "it's night",
// indistinguishably). Night still gets a genuinely dark base though, not
// just a stronger tint of the same light one.
const LIGHT_BASE_RGB: [number, number, number] = [250, 250, 247]
const DARK_BASE_RGB: [number, number, number] = [16, 17, 23]
const TEXT_COLOR = 'black'

// One identity colour per asset category (echoes the icon's own palette),
// mixed into the base so the background reads as "tinted by the weather"
// rather than a mood-board of colours.
const CATEGORY_HUE: Record<WeatherAssetCategory, string> = {
  sonnig: '#E8A33D',
  'klar-nacht': '#3B3D6B',
  'teilweise-bewoelkt': '#8FA6B8',
  'teilweise-bewoelkt-nacht': '#4E5C77',
  bedeckt: '#7C8894',
  'bedeckt-nacht': '#4A5058',
  nebel: '#B7C0C7',
  'regen-leicht': '#6FA3C4',
  'regen-stark': '#2C5F87',
  gewitter: '#5F707C',
  'gewitter-nacht': '#3A434B',
  schnee: '#A9C7DC',
  'schnee-nacht': '#5D7C93',
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Blends `hex` into `base` at `amount` (0 = pure base, 1 = pure hex).
function mixRgb(hex: string, base: [number, number, number], amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const [br, bg, bb] = base
  const mr = Math.round(br + (r - br) * amount)
  const mg = Math.round(bg + (g - bg) * amount)
  const mb = Math.round(bb + (b - bb) * amount)
  return `rgb(${mr}, ${mg}, ${mb})`
}

// Day mixes the weather colour into a light base; night mixes it into an
// actually dark one — not just a heavier tint of the daytime pastel.
function weatherBackground(category: WeatherAssetCategory, isDay: boolean): string {
  if (isDay) return mixRgb(CATEGORY_HUE[category], LIGHT_BASE_RGB, 0.4)
  return mixRgb(CATEGORY_HUE[category], DARK_BASE_RGB, 0.5)
}

// ─── Data ─────────────────────────────────────────────────────────────────────

interface WeatherData {
  temperature: number
  weatherCode: number
  isDay: boolean
  windKmh: number
  sunrise: Date
  sunset: Date
  tomorrow?: { weatherCode: number; maxTemp: number }
  // "Now" as far as the announcement is concerned — real wall-clock time
  // for live data, but a synthetic time in test-cycle mode so the sun
  // position phrase matches the synthetic sunrise/sunset instead of reality.
  announcementNow: Date
}

// `testCycle` picks a fresh synthetic scenario once per mount (see
// weatherTestScenarios.ts) instead of calling Open-Meteo — every module
// reload therefore shows a different time of day, temperature and weather.
function useWeatherData(latitude: number, longitude: number, testCycle: boolean) {
  const [data, setData] = useState<WeatherData | null>(() =>
    testCycle ? buildTestWeatherData(nextTestScenario()) : null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (testCycle) return
    let cancelled = false
    setData(null)
    setError(null)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,is_day,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,sunrise,sunset` +
      `&timezone=auto&forecast_days=2`

    // Without this, a dead/unreachable connection can leave fetch() hanging
    // far longer than a kiosk display should wait before giving up and
    // skipping the module (see the "no data → onModuleDone" effect above).
    const REQUEST_TIMEOUT_MS = 3000
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)

    fetch(url, { signal: timeoutController.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (cancelled) return
        setData({
          temperature: json.current.temperature_2m,
          weatherCode: json.current.weather_code,
          isDay: json.current.is_day === 1,
          windKmh: json.current.wind_speed_10m,
          sunrise: new Date(json.daily.sunrise[0]),
          sunset: new Date(json.daily.sunset[0]),
          tomorrow:
            json.daily.weather_code[1] !== undefined
              ? {
                  weatherCode: json.daily.weather_code[1],
                  maxTemp: json.daily.temperature_2m_max[1],
                }
              : undefined,
          announcementNow: new Date(),
        })
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof DOMException && err.name === 'AbortError'
              ? `timed out after ${REQUEST_TIMEOUT_MS}ms`
              : err instanceof Error
                ? err.message
                : String(err)
          setError(message)
        }
      })
      .finally(() => clearTimeout(timeoutId))

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [latitude, longitude, testCycle])

  return { data, error }
}

// ─── Announcement text ────────────────────────────────────────────────────────

// "X, Y und Z" — German list join, used for the 2-3 descriptors in one sentence.
function joinGerman(parts: (string | undefined)[]): string {
  const list = parts.filter((p): p is string => !!p)
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`
}

function buildAnnouncement(
  data: WeatherData,
  showTemperature: boolean,
  announceTomorrow: boolean,
): string {
  const parts: string[] = ['Hier ist das Wetter von heute.']
  const sunPhrase = sunPositionPhrase(data.announcementNow, data.sunrise, data.sunset)
  if (sunPhrase) parts.push(sunPhrase)

  // Temperature/wind (predicate adjectives) and the weather condition (its
  // own full sentence — see weatherConditionSentence) are kept as separate
  // sentences rather than spliced together, since most WMO conditions are
  // nouns ("Gewitter", "Nebel") that read as broken German glued onto
  // "Es ist heiss und ___".
  const todayDescriptors = joinGerman([
    temperatureTerm(data.temperature),
    windModifier(data.windKmh),
  ])
  parts.push(`Es ist ${todayDescriptors}.`)
  parts.push(weatherConditionSentence(data.weatherCode))

  if (showTemperature) {
    parts.push(`Draussen hat es ${Math.round(data.temperature)} Grad.`)
  }

  if (announceTomorrow && data.tomorrow) {
    // Descriptive terms only — no degree number for tomorrow, unlike
    // today's optional exact temperature. Both sentences are fronted with
    // "Morgen" so neither can be misread as a statement about today.
    parts.push(`Morgen ist es ${temperatureTerm(data.tomorrow.maxTemp)}.`)
    parts.push(weatherConditionSentenceTomorrow(data.tomorrow.weatherCode))
  }

  return parts.join(PAUSE)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusScreen({ text }: { text: string }) {
  // isDay isn't known yet at this point (still loading, or failed before
  // ever getting data) — always the light base, since this screen is brief.
  const [r, g, b] = LIGHT_BASE_RGB
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        bgcolor: `rgb(${r}, ${g}, ${b})`,
      }}
    >
      <Typography sx={{ fontFamily: FONT, fontSize: '2rem', color: TEXT_COLOR }}>{text}</Typography>
    </Box>
  )
}

// White rounded square, black text — always legible regardless of what's
// behind it (a tinted background in icon mode, an arbitrary photo in photo
// mode).
function TemperatureBadge({ value }: { value: number }) {
  return (
    <Box
      sx={{
        width: '24vh',
        height: '24vh',
        borderRadius: '3vh',
        bgcolor: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
      }}
    >
      <Typography
        sx={{
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: '6.5rem',
          lineHeight: 1,
          color: 'black',
        }}
      >
        {Math.round(value)}°
      </Typography>
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Weather({
  onShutdownRequest,
  onModuleDone,
  latitude = DEFAULT_LATITUDE,
  longitude = DEFAULT_LONGITUDE,
  imageSource = 'icon',
  showTemperature = true,
  announceTomorrow = false,
  audio = true,
  voice = 'female',
  readingSpeed = 'normal',
  pause = 'medium',
  repeat = false,
  testCycle = false,
}: WeatherProps) {
  const { data, error } = useWeatherData(latitude, longitude, testCycle)
  const rate = READING_RATE[readingSpeed] ?? 1.0
  const pauseMs = SHORT_PAUSE_MS[pause] ?? 0
  const repeatGapMs = LONG_PAUSE_MS[pause] ?? 0

  const interruptDoneRef = useRef<(() => void) | null>(null)
  const hasStartedRef = useRef(false)
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])

  useEffect(() => {
    onShutdownRequest?.(() => {
      if (isSpeaking()) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest])

  // No data (typically: no internet connection) — nothing useful to show,
  // so skip straight to the next module instead of sitting on an error
  // screen for the module's whole duration. onModuleDone advances the
  // scheduler immediately, same mechanism as a normal shutdown handoff.
  useEffect(() => {
    if (error) onModuleDoneRef.current?.()
  }, [error])

  useEffect(() => {
    if (!audio || !data) return
    let repeated = false
    let repeatTimer: ReturnType<typeof setTimeout> | null = null

    function playOnce() {
      const text = buildAnnouncement(data!, showTemperature, announceTomorrow)
      speak(text, { voice: voice as TtsVoice, rate, pauseMs, onEnd: handleEnd })
    }

    function handleEnd() {
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
        return
      }
      if (repeat && !repeated) {
        repeated = true
        repeatTimer = setTimeout(playOnce, repeatGapMs)
      }
    }

    // Pause before the module's very first utterance too — only once per
    // module instance, matching Time/Routine's convention.
    const startDelay = hasStartedRef.current ? 0 : repeatGapMs
    hasStartedRef.current = true
    const startTimer = setTimeout(playOnce, startDelay)

    return () => {
      clearTimeout(startTimer)
      if (repeatTimer) clearTimeout(repeatTimer)
      stop()
    }
  }, [data, audio, voice, rate, pauseMs, repeat, repeatGapMs, showTemperature, announceTomorrow])

  if (error) return <StatusScreen text="Wetter nicht verfügbar" />
  if (!data) return <StatusScreen text="Lade Wetter…" />

  const category = weatherAssetCategory(data.weatherCode, data.isDay)
  const imageSrc = imageSource === 'photo' ? PHOTOS[category] : ICONS[category]
  const isPhoto = imageSource === 'photo'
  const bg = weatherBackground(category, data.isDay)

  // Deliberately minimal — the image itself carries the weather, spoken
  // audio carries the detail. The only optional text is the temperature.
  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        bgcolor: bg,
        overflow: 'hidden',
      }}
    >
      {isPhoto ? (
        <>
          <Box
            component="img"
            src={imageSrc}
            alt=""
            sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {showTemperature && (
            <Box sx={{ position: 'absolute', bottom: '8%' }}>
              <TemperatureBadge value={data.temperature} />
            </Box>
          )}
        </>
      ) : (
        // Icon + temperature share one white card — several icons have a
        // hue close to the tinted page background, so without it they'd
        // lose contrast against it.
        <Box
          sx={{
            bgcolor: '#fff',
            borderRadius: '4vh',
            padding: '3vh',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1vh',
          }}
        >
          <Box
            component="img"
            src={imageSrc}
            alt=""
            sx={{ width: '65vh', height: '65vh', objectFit: 'contain', display: 'block' }}
          />
          {showTemperature && (
            // Plain text, not TemperatureBadge — the icon already sits on a
            // white card, so a second nested white box would be redundant.
            <Typography
              sx={{
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: '8rem',
                lineHeight: 1,
                color: TEXT_COLOR,
              }}
            >
              {Math.round(data.temperature)}°
            </Typography>
          )}
        </Box>
      )}
    </Box>
  )
}

export default Weather
