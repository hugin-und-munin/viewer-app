import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { speak, stop, isSpeaking, type TtsVoice } from '../../utils/tts'
import { DAY_OUTLINE_COLORS, DAY_OUTLINE_WIDTH } from '../../utils/dayColors'
import type { TimeProps } from '../../types/modules'
import { READING_RATE, LONG_PAUSE_MS } from '../../utils/ttsPacing'
import {
  roundToNearest5Minutes,
  naturalTimePhrase,
  exactTimePhrase,
} from '../../utils/timeAnnouncement'

const FONT = "'Atkinson Hyperlegible', sans-serif"

// ─── Theme ────────────────────────────────────────────────────────────────────

type TimeColors = { bg: string; text: string }

const TIME_COLORS: Record<'light' | 'dark', TimeColors> = {
  light: { bg: 'white', text: 'black' },
  dark: { bg: '#18181b', text: '#f4f4f5' },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TimeAnnouncement = 'natural' | 'exact'

// "natural": rounded to 5 minutes, spoken as "Viertel nach zehn" etc.
// "exact": minute-precise, always 24h digits — see exactTimePhrase for why.
function timeText(date: Date, mode: TimeAnnouncement): string {
  const phrase =
    mode === 'exact' ? exactTimePhrase(date) : naturalTimePhrase(roundToNearest5Minutes(date))
  return `Es ist ${phrase}.`
}

function dateText(date: Date): string {
  const weekday = date.toLocaleDateString('de-DE', { weekday: 'long' })
  const month = date.toLocaleDateString('de-DE', { month: 'long' })
  return `Heute ist ${weekday}, der ${date.getDate()}. ${month}.`
}

function speakClock(
  date: Date,
  showDate: boolean,
  voice: TtsVoice,
  rate: number,
  timeAnnouncement: TimeAnnouncement,
  onEnd?: () => void,
): void {
  const text = showDate
    ? `${dateText(date)} ${timeText(date, timeAnnouncement)}`
    : timeText(date, timeAnnouncement)
  speak(text, { voice, rate, onEnd })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DateDisplay({ now, colors }: { now: Date; colors: TimeColors }) {
  return (
    <Typography
      sx={{
        fontFamily: FONT,
        fontSize: '2.2rem',
        color: colors.text,
        mt: 3,
        letterSpacing: '0.02em',
      }}
    >
      {formatDate(now)}
    </Typography>
  )
}

function DigitalClock({
  now,
  format = 'HH:mm',
  showSeconds = false,
  colors,
}: {
  now: Date
  format?: string
  showSeconds?: boolean
  colors: TimeColors
}) {
  const use12h = format === 'hh:mm a'
  const timeStr = now.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    ...(showSeconds ? { second: '2-digit' } : {}),
    hour12: use12h,
  })

  return (
    <Typography
      sx={{
        fontFamily: FONT,
        fontSize: '14rem',
        fontWeight: 700,
        color: colors.text,
        lineHeight: 1,
        letterSpacing: '0.05em',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {timeStr}
    </Typography>
  )
}

function handPoint(cx: number, cy: number, length: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + length * Math.cos(rad), y: cy + length * Math.sin(rad) }
}

function AnalogClock({
  now,
  showSeconds = false,
  colors,
}: {
  now: Date
  showSeconds?: boolean
  colors: TimeColors
}) {
  const h = now.getHours() % 12
  const m = now.getMinutes()
  const s = now.getSeconds()

  const hourAngle = (h + m / 60) * 30
  const minuteAngle = (m + s / 60) * 6
  const secondAngle = s * 6

  const cx = 100
  const cy = 100
  const hour = handPoint(cx, cy, 52, hourAngle)
  const minute = handPoint(cx, cy, 70, minuteAngle)
  const second = handPoint(cx, cy, 74, secondAngle)

  const timeLabel = now.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Box sx={{ width: 'min(65vh, 65vw)', aspectRatio: '1 / 1' }}>
      <svg
        role="img"
        aria-label={`Analoguhr zeigt ${timeLabel} Uhr`}
        viewBox="0 0 200 200"
        style={{ width: '100%', height: '100%' }}
      >
        {/* Face */}
        <circle cx={cx} cy={cy} r={90} fill={colors.bg} stroke={colors.text} strokeWidth={4} />

        {/* Hour & minute markers */}
        {Array.from({ length: 60 }, (_, i) => {
          const isHour = i % 5 === 0
          const outer = 86
          const inner = isHour ? 73 : 81
          const p1 = handPoint(cx, cy, outer, i * 6)
          const p2 = handPoint(cx, cy, inner, i * 6)
          return (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={colors.text}
              strokeWidth={isHour ? 2.5 : 1}
              strokeLinecap="round"
            />
          )
        })}

        {/* Hour hand */}
        <line
          x1={cx}
          y1={cy}
          x2={hour.x}
          y2={hour.y}
          stroke={colors.text}
          strokeWidth={7}
          strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={cx}
          y1={cy}
          x2={minute.x}
          y2={minute.y}
          stroke={colors.text}
          strokeWidth={4}
          strokeLinecap="round"
        />

        {/* Second hand */}
        {showSeconds && (
          <line
            x1={cx}
            y1={cy}
            x2={second.x}
            y2={second.y}
            stroke="#dc2626"
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={5} fill={colors.text} />
        {showSeconds && <circle cx={cx} cy={cy} r={3} fill="#dc2626" />}
      </svg>
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Time({
  onShutdownRequest,
  onModuleDone,
  clockType = 'digital',
  format = 'HH:mm',
  showSeconds = false,
  showDate = true,
  audio = true,
  voice = 'female',
  readingSpeed = 'normal',
  pause = 'medium',
  repeat = false,
  timeAnnouncement = 'natural',
  theme = 'light',
}: TimeProps) {
  const colors = TIME_COLORS[theme]
  const rate = READING_RATE[readingSpeed] ?? 1.0
  const repeatGapMs = LONG_PAUSE_MS[pause] ?? 0
  const [now, setNow] = useState(new Date())
  const interruptDoneRef = useRef<(() => void) | null>(null)
  const hasStartedRef = useRef(false)
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

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
    if (!audio) return
    let repeated = false
    let repeatTimer: ReturnType<typeof setTimeout> | null = null

    function playOnce() {
      speakClock(new Date(), showDate, voice, rate, timeAnnouncement, handleEnd)
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
    // module instance (a fresh mount per showModule() call), not on every
    // re-run of this effect within the same showing.
    const startDelay = hasStartedRef.current ? 0 : repeatGapMs
    hasStartedRef.current = true
    const startTimer = setTimeout(playOnce, startDelay)

    return () => {
      clearTimeout(startTimer)
      if (repeatTimer) clearTimeout(repeatTimer)
      stop()
    }
  }, [showDate, voice, rate, audio, repeat, repeatGapMs, timeAnnouncement])

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: colors.bg,
        outline: `${DAY_OUTLINE_WIDTH} solid ${DAY_OUTLINE_COLORS[now.getDay()]}`,
        outlineOffset: `-${DAY_OUTLINE_WIDTH}`,
        boxSizing: 'border-box',
      }}
    >
      {clockType === 'analog' ? (
        <AnalogClock now={now} showSeconds={showSeconds} colors={colors} />
      ) : (
        <DigitalClock now={now} format={format} showSeconds={showSeconds} colors={colors} />
      )}
      {showDate && <DateDisplay now={now} colors={colors} />}
    </Box>
  )
}

export default Time
