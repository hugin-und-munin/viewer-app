import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { speak, stop, isSpeaking, PAUSE, type TtsVoice } from '../../utils/tts'
import type { WeatherProps } from '../../types/modules'
import { READING_RATE, SHORT_PAUSE_MS, LONG_PAUSE_MS } from '../../utils/ttsPacing'
import {
  weatherAssetCategory,
  weatherConditionPhrase,
  temperatureTerm,
  windModifier,
  sunPositionPhrase,
  type WeatherAssetCategory,
} from '../../utils/weatherAnnouncement'

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

import photoSonnig from '../../assets/weather-photos/sonnig.svg'
import photoKlarNacht from '../../assets/weather-photos/klar-nacht.svg'
import photoTeilweiseBewoelkt from '../../assets/weather-photos/teilweise-bewoelkt.svg'
import photoTeilweiseBewoelktNacht from '../../assets/weather-photos/teilweise-bewoelkt-nacht.svg'
import photoBedeckt from '../../assets/weather-photos/bedeckt.svg'
import photoNebel from '../../assets/weather-photos/nebel.svg'
import photoRegenLeicht from '../../assets/weather-photos/regen-leicht.svg'
import photoRegenStark from '../../assets/weather-photos/regen-stark.svg'
import photoGewitter from '../../assets/weather-photos/gewitter.svg'
import photoSchnee from '../../assets/weather-photos/schnee.svg'

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Atkinson Hyperlegible', sans-serif"

// Solothurn city centre — the module's default location until a family
// member sets a different one in content-app.
const DEFAULT_LATITUDE = 47.2088
const DEFAULT_LONGITUDE = 7.5323

const ICONS: Record<WeatherAssetCategory, string> = {
  sonnig: iconSonnig,
  'klar-nacht': iconKlarNacht,
  'teilweise-bewoelkt': iconTeilweiseBewoelkt,
  'teilweise-bewoelkt-nacht': iconTeilweiseBewoelktNacht,
  bedeckt: iconBedeckt,
  nebel: iconNebel,
  'regen-leicht': iconRegenLeicht,
  'regen-stark': iconRegenStark,
  gewitter: iconGewitter,
  schnee: iconSchnee,
}

// Dummy stand-ins until real, licensed nature photos are sourced per category.
const PHOTOS: Record<WeatherAssetCategory, string> = {
  sonnig: photoSonnig,
  'klar-nacht': photoKlarNacht,
  'teilweise-bewoelkt': photoTeilweiseBewoelkt,
  'teilweise-bewoelkt-nacht': photoTeilweiseBewoelktNacht,
  bedeckt: photoBedeckt,
  nebel: photoNebel,
  'regen-leicht': photoRegenLeicht,
  'regen-stark': photoRegenStark,
  gewitter: photoGewitter,
  schnee: photoSchnee,
}

// ─── Theme ────────────────────────────────────────────────────────────────────

// One identity colour per asset category (echoes the icon's own palette),
// mixed faintly into the theme's base so the background reads as "the
// theme, tinted by the weather" rather than a mood-board of colours.
const CATEGORY_HUE: Record<WeatherAssetCategory, string> = {
  sonnig: '#E8A33D',
  'klar-nacht': '#3B3D6B',
  'teilweise-bewoelkt': '#8FA6B8',
  'teilweise-bewoelkt-nacht': '#4E5C77',
  bedeckt: '#7C8894',
  nebel: '#B7C0C7',
  'regen-leicht': '#6FA3C4',
  'regen-stark': '#2C5F87',
  gewitter: '#5F707C',
  schnee: '#A9C7DC',
}

const THEME_BASE: Record<'light' | 'dark', [number, number, number]> = {
  light: [250, 250, 247],
  dark: [24, 26, 32],
}
const THEME_TEXT: Record<'light' | 'dark', string> = {
  light: 'black',
  dark: '#f4f4f5',
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

// Night leans in a touch more than day — still subtle, just enough to feel
// like dusk/dark rather than a straight recolour.
function weatherBackground(
  theme: 'light' | 'dark',
  category: WeatherAssetCategory,
  isDay: boolean,
): string {
  return mixRgb(CATEGORY_HUE[category], THEME_BASE[theme], isDay ? 0.16 : 0.24)
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
}

function useWeatherData(latitude: number, longitude: number) {
  const [data, setData] = useState<WeatherData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code,is_day,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,sunrise,sunset` +
      `&timezone=auto&forecast_days=2`

    fetch(url)
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
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [latitude, longitude])

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
  now: Date,
  showTemperature: boolean,
  announceTomorrow: boolean,
): string {
  const parts: string[] = ['Hier ist das Wetter von heute.']
  const sunPhrase = sunPositionPhrase(now, data.sunrise, data.sunset)
  if (sunPhrase) parts.push(sunPhrase)

  const todayDescriptors = joinGerman([
    temperatureTerm(data.temperature),
    windModifier(data.windKmh),
    weatherConditionPhrase(data.weatherCode),
  ])
  parts.push(`Es ist ${todayDescriptors}.`)

  if (showTemperature) {
    parts.push(`Draussen hat es ${Math.round(data.temperature)} Grad.`)
  }

  if (announceTomorrow && data.tomorrow) {
    const tomorrowDescriptors = joinGerman([
      temperatureTerm(data.tomorrow.maxTemp),
      weatherConditionPhrase(data.tomorrow.weatherCode),
    ])
    parts.push(
      `Morgen ist es ${tomorrowDescriptors}. Die Temperaturen erreichen ${Math.round(data.tomorrow.maxTemp)} Grad.`,
    )
  }

  return parts.join(PAUSE)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusScreen({ text, theme }: { text: string; theme: 'light' | 'dark' }) {
  const [r, g, b] = THEME_BASE[theme]
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
      <Typography sx={{ fontFamily: FONT, fontSize: '2rem', color: THEME_TEXT[theme] }}>
        {text}
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
  theme = 'light',
}: WeatherProps) {
  const { data, error } = useWeatherData(latitude, longitude)
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

  useEffect(() => {
    if (!audio || !data) return
    let repeated = false
    let repeatTimer: ReturnType<typeof setTimeout> | null = null

    function playOnce() {
      const text = buildAnnouncement(data!, new Date(), showTemperature, announceTomorrow)
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

  if (error) return <StatusScreen text="Wetter nicht verfügbar" theme={theme} />
  if (!data) return <StatusScreen text="Lade Wetter…" theme={theme} />

  const category = weatherAssetCategory(data.weatherCode, data.isDay)
  const imageSrc = imageSource === 'photo' ? PHOTOS[category] : ICONS[category]
  const isPhoto = imageSource === 'photo'
  const bg = weatherBackground(theme, category, data.isDay)
  const textColor = THEME_TEXT[theme]

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
            <Typography
              sx={{
                position: 'absolute',
                bottom: '8%',
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: '6rem',
                color: '#fff',
                textShadow: '0 2px 16px rgba(0,0,0,0.5)',
              }}
            >
              {Math.round(data.temperature)}°
            </Typography>
          )}
        </>
      ) : (
        // Icon + temperature centred as one group, not the icon alone with
        // the number pinned far below at the screen edge.
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2vh' }}>
          <Box
            component="img"
            src={imageSrc}
            alt=""
            sx={{ width: '40vh', height: '40vh', objectFit: 'contain', display: 'block' }}
          />
          {showTemperature && (
            <Typography
              sx={{
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: '6rem',
                lineHeight: 1,
                color: textColor,
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
