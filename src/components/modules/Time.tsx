import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { speak, stop } from '../../utils/tts'
import type { TimeProps } from '../../types/modules'

const FONT = "'Atkinson Hyperlegible', sans-serif"

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function speakTime(date: Date, onEnd?: () => void): void {
  const h = date.getHours()
  const m = date.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  const nextH12 = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12

  let text: string
  if (m === 0) text = `Es ist ${h} Uhr.`
  else if (m === 15) text = `Es ist Viertel nach ${hourWord(h12)}.`
  else if (m === 30) text = `Es ist halb ${hourWord(nextH12)}.`
  else if (m === 45) text = `Es ist Viertel vor ${hourWord(nextH12)}.`
  else text = `Es ist ${h} Uhr ${m}.`

  speak(text, { onEnd })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DateDisplay({ now }: { now: Date }) {
  return (
    <Typography
      sx={{
        fontFamily: FONT,
        fontSize: '2.2rem',
        color: 'black',
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
}: {
  now: Date
  format?: string
  showSeconds?: boolean
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
        color: 'black',
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

function AnalogClock({ now, showSeconds = false }: { now: Date; showSeconds?: boolean }) {
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
        <circle cx={cx} cy={cy} r={90} fill="white" stroke="black" strokeWidth={4} />

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
              stroke="black"
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
          stroke="black"
          strokeWidth={7}
          strokeLinecap="round"
        />

        {/* Minute hand */}
        <line
          x1={cx}
          y1={cy}
          x2={minute.x}
          y2={minute.y}
          stroke="black"
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
        <circle cx={cx} cy={cy} r={5} fill="black" />
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
}: TimeProps) {
  const [now, setNow] = useState(new Date())
  const interruptDoneRef = useRef<(() => void) | null>(null)
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
      if (window.speechSynthesis.speaking) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest])

  useEffect(() => {
    speakTime(new Date(), () => {
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
      }
    })
    return () => stop()
  }, [])

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {clockType === 'analog' ? (
        <AnalogClock now={now} showSeconds={showSeconds} />
      ) : (
        <DigitalClock now={now} format={format} showSeconds={showSeconds} />
      )}
      {showDate && <DateDisplay now={now} />}
    </Box>
  )
}

export default Time
