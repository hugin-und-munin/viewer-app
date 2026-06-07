import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { RoutineProps } from '../../types/modules'
import { speak, stop, getVoices } from '../../utils/tts'
import { getApi } from '../../api/api'

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Atkinson Hyperlegible', sans-serif"

const READING_RATE: Record<string, number> = {
  slow: 0.7,
  normal: 1.0,
  fast: 1.4,
}
const FEMALE_HINTS = /katja|anna|helena|petra|female|weiblich/i
const MALE_HINTS = /stefan|markus|conrad|hans|yannick|male|männlich/i

const MORNING_START = 8
const MORNING_END = 12
const AFTERNOON_END = 20
const EVENING_END = 24
const CARD_GAP = 16

const DAY_COLORS: Record<number, string> = {
  1: '#F5C518', // Montag     – Gelb
  2: '#4CAF50', // Dienstag   – Grün
  3: '#2196F3', // Mittwoch   – Blau
  4: '#FF9800', // Donnerstag – Orange
  5: '#9C27B0', // Freitag    – Lila
  6: '#E91E63', // Samstag    – Pink
  0: '#00BCD4', // Sonntag    – Türkis
}

const DAY_OUTLINE_COLORS: Record<number, string> = {
  1: '#bd8d00', // Montag     – Gelb   (3.01:1)
  2: '#44a748', // Dienstag   – Grün   (3.06:1)
  3: '#2196F3', // Mittwoch   – Blau   (3.12:1, unchanged)
  4: '#e17a00', // Donnerstag – Orange (3.01:1)
  5: '#9C27B0', // Freitag    – Lila   (6.30:1, unchanged)
  6: '#E91E63', // Samstag    – Pink   (4.35:1, unchanged)
  0: '#00a2ba', // Sonntag    – Türkis (3.05:1)
}

const DAY_NAMES = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

// ─── Types ────────────────────────────────────────────────────────────────────

interface Appointment {
  id: string
  title: string
  description: string
  start_at: string
  end_at: string
  icon?: string
}

interface ModuleDataEntry {
  id: string
  module_id: string
  data: {
    title: string
    description: string
    start_at: string
    end_at: string
    icon?: string
  }
  created_at: string
}

type TimeSlot = 'morning' | 'afternoon' | 'evening'

// ─── Color helpers ────────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const num = parseInt(hex.replace('#', ''), 16)
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

function darkenColor(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  const clamp = (v: number) =>
    Math.max(0, v - amount)
      .toString(16)
      .padStart(2, '0')
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function darkenForWhiteText(hex: string): string {
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance = (h: string) => {
    const [r, g, b] = parseHex(h)
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  }

  for (let amount = 0; amount <= 200; amount += 5) {
    const darkened = darkenColor(hex, amount)
    if (1.05 / (luminance(darkened) + 0.05) >= 4.5) return darkened
  }
  return darkenColor(hex, 200)
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function getTimeSlot(date: Date): TimeSlot {
  const h = date.getHours()
  if (h < MORNING_END) return 'morning'
  if (h < AFTERNOON_END) return 'afternoon'
  return 'evening'
}

function getPeriodLabel(slot: TimeSlot): string {
  if (slot === 'morning') return 'Morgen'
  if (slot === 'afternoon') return 'Nachmittag'
  return 'Abend'
}

function getGreeting(date: Date): string {
  const h = date.getHours()
  if (h < 12) return 'Guten Morgen!'
  if (h < 18) return 'Guten Nachmittag!'
  return 'Guten Abend!'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  const m = d.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  const nextH12 = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12
  if (m === 0) return `${h12} Uhr`
  if (m === 15) return `Viertel nach ${h12}`
  if (m === 30) return `halb ${nextH12}`
  if (m === 45) return `Viertel vor ${nextH12}`
  return `${h12} Uhr ${m}`
}

// ─── Appointment helpers ──────────────────────────────────────────────────────

function filterBySlot(appointments: Appointment[], now: Date): Appointment[] {
  const todayStr = now.toISOString().slice(0, 10)
  const slot = getTimeSlot(now)
  const [startH, endH] =
    slot === 'morning'
      ? [MORNING_START, MORNING_END]
      : slot === 'afternoon'
        ? [MORNING_END, AFTERNOON_END]
        : [AFTERNOON_END, EVENING_END]

  const slotStart = new Date(`${todayStr}T${String(startH).padStart(2, '0')}:00:00`)
  const slotEnd = new Date(`${todayStr}T${String(endH).padStart(2, '0')}:00:00`)

  return appointments.filter((a) => {
    const start = new Date(a.start_at)
    const end = new Date(a.end_at)
    return start.toISOString().slice(0, 10) === todayStr && start < slotEnd && end > slotStart
  })
}

function findActiveIndex(appointments: Appointment[], now: Date): number {
  return appointments.findIndex((a) => now >= new Date(a.start_at) && now < new Date(a.end_at))
}

const DIGIT_WORDS: Record<string, string> = {
  '0': 'null',
  '1': 'eins',
  '2': 'zwei',
  '3': 'drei',
  '4': 'vier',
  '5': 'fünf',
  '6': 'sechs',
  '7': 'sieben',
  '8': 'acht',
  '9': 'neun',
}

function breakOrdinal(text: string): string {
  return text.replace(/([a-zA-ZäöüÄÖÜß])\s+(\d+)/g, (_, letter, digits) =>
    digits.length === 1 ? `${letter} ${DIGIT_WORDS[digits] ?? digits}` : `${letter}, ${digits}`,
  )
}

function buildTTSText(
  active: Appointment | undefined,
  next: Appointment | undefined,
  dayName: string,
  periodLabel: string,
): string {
  const now = new Date()
  const intro = `${getGreeting(now)} Hier ist deine Tagesroutine für ${dayName} ${periodLabel}.`
  const activePart = active
    ? `Du befindest dich gerade bei: ${breakOrdinal(active.title)}, von ${formatTime(active.start_at)} bis ${formatTime(active.end_at)}. ${breakOrdinal(active.description)}`
    : 'Momentan ist kein Termin aktiv.'
  const nextPart = next
    ? `Als nächstes folgt: ${breakOrdinal(next.title)}. ${breakOrdinal(next.description)}`
    : ''

  return [intro, activePart, nextPart].filter(Boolean).join(' ')
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAppointments(moduleId: string) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getApi()
      .get<ModuleDataEntry[]>(`/modules/${moduleId}/data`, { ttl: 0 })
      .then((entries) =>
        setAppointments(
          entries
            .map((e) => ({
              id: e.id,
              title: e.data.title,
              description: e.data.description,
              start_at: e.data.start_at,
              end_at: e.data.end_at,
              icon: e.data.icon,
            }))
            .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()),
        ),
      )
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [moduleId])

  return { appointments, loading, error }
}

function useVoice(pref: 'male' | 'female' | undefined): SpeechSynthesisVoice | undefined {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | undefined>()
  useEffect(() => {
    if (!pref) return
    const pick = () => {
      const german = getVoices().filter((v) => v.lang.startsWith('de'))
      if (!german.length) return
      const hints = pref === 'female' ? FEMALE_HINTS : MALE_HINTS
      const opposite = pref === 'female' ? MALE_HINTS : FEMALE_HINTS
      setVoice(
        german.find((v) => hints.test(v.name)) ??
          german.find((v) => !opposite.test(v.name)) ??
          german[0],
      )
    }
    pick()
    window.speechSynthesis.addEventListener('voiceschanged', pick)
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pick)
    }
  }, [pref])
  return voice
}

function useRowSize(loading: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loading])

  return { ref, size }
}

function useTTS(
  active: Appointment | undefined,
  next: Appointment | undefined,
  loading: boolean,
  onShutdownRequest: RoutineProps['onShutdownRequest'],
  onModuleDone: RoutineProps['onModuleDone'],
  dayName: string,
  periodLabel: string,
  audio: boolean,
  rate: number,
  hasAppointments: boolean,
  voice?: SpeechSynthesisVoice,
) {
  const interruptDoneRef = useRef<(() => void) | null>(null)

  const paramsRef = useRef({
    active,
    next,
    rate,
    voice,
    hasAppointments,
    onModuleDone,
  })
  useEffect(() => {
    paramsRef.current = {
      active,
      next,
      rate,
      voice,
      hasAppointments,
      onModuleDone,
    }
  }, [active, next, rate, voice, hasAppointments, onModuleDone])

  useEffect(() => {
    onShutdownRequest?.(() => {
      if (window.speechSynthesis.speaking) {
        interruptDoneRef.current = () => paramsRef.current.onModuleDone?.()
      } else {
        paramsRef.current.onModuleDone?.()
      }
    })
  }, [onShutdownRequest])

  useEffect(() => {
    if (!audio || loading) return
    const {
      active: a,
      next: n,
      rate: r,
      voice: v,
      hasAppointments: has,
      onModuleDone: done,
    } = paramsRef.current
    speak(buildTTSText(a, n, dayName, periodLabel), {
      rate: r,
      voice: v,
      onEnd: () => {
        if (interruptDoneRef.current) {
          interruptDoneRef.current()
          interruptDoneRef.current = null
        } else if (!has) {
          done?.()
        }
      },
    })
    return () => stop()
  }, [active?.id, next?.id, dayName, periodLabel, audio, loading])
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusScreen({ text, role = 'status' }: { text: string; role?: 'status' | 'alert' }) {
  return (
    <Box
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
      }}
    >
      <Typography sx={{ fontFamily: FONT, fontSize: '2rem' }}>{text}</Typography>
    </Box>
  )
}

function useFitFontSize(text: string, maxPx: number, minPx = 12) {
  const ref = useRef<HTMLElement>(null)
  const [fontSize, setFontSize] = useState(maxPx)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.parentElement) return
    const limit = el.parentElement.clientHeight
    let size = maxPx
    el.style.fontSize = `${size}px`
    while (size > minPx && el.scrollHeight > limit) {
      size -= 2
      el.style.fontSize = `${size}px`
    }
    setFontSize(size)
  }, [text, maxPx, minPx])

  return { ref, fontSize }
}

function AppointmentCard({
  appointment,
  isActive,
  isPast,
  dayColor,
  size,
  animated,
}: {
  appointment: Appointment
  isActive: boolean
  isPast: boolean
  dayColor: string
  size: number
  animated: boolean
}) {
  const bgColor = isActive ? darkenForWhiteText(dayColor) : hexToRgba(dayColor, isPast ? 0.3 : 0.45)

  const maxFontSize = Math.round(size * 0.3)
  const { ref: textRef, fontSize } = useFitFontSize(appointment.title, maxFontSize)

  return (
    <Box
      role="listitem"
      aria-current={isActive ? 'true' : undefined}
      aria-label={appointment.icon ? `${appointment.title} (Besuch)` : appointment.title}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: bgColor,
        borderRadius: isActive ? '50%' : `${size * 0.13}px`,
        width: size,
        height: size,
        flexShrink: 0,
        transform: isActive ? 'scale(1.1)' : 'none',
        mx: isActive ? `${size * 0.08}px` : 0,
        boxShadow: isActive ? '0 4px 20px rgba(0,0,0,0.3)' : 'none',
        transition: animated ? 'all 0.3s ease' : 'none',
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none !important',
        },
        px: isActive ? 0 : 1,
        overflow: 'hidden',
      }}
    >
      {appointment.icon ? (
        <Box
          aria-hidden="true"
          sx={{
            fontSize: `${Math.round(size * 0.45)}px`,
            lineHeight: 1.2,
            userSelect: 'none',
          }}
        >
          {appointment.icon}
        </Box>
      ) : (
        <Typography
          ref={textRef as RefObject<HTMLElement>}
          lang="de"
          sx={{
            fontFamily: FONT,
            fontSize,
            fontWeight: isActive ? 700 : 500,
            color: isActive ? 'white' : isPast ? 'grey.800' : 'black',
            textAlign: 'center',
            lineHeight: 1.3,
            textShadow: isActive ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
            overflowWrap: 'break-word',
            hyphens: 'auto',
            wordBreak: 'break-word',
            width: '100%',
          }}
        >
          {appointment.title}
        </Typography>
      )}
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Routine({
  onShutdownRequest,
  onModuleDone,
  module_id,
  audio = true,
  voice = 'female',
  readingSpeed = 'normal',
}: RoutineProps) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const dayColor = DAY_COLORS[now.getDay()]
  const dayName = DAY_NAMES[now.getDay()]
  const periodLabel = getPeriodLabel(getTimeSlot(now))

  const { appointments, loading, error } = useAppointments(module_id)
  const { ref: rowRef, size: rowSize } = useRowSize(loading)
  const ttsVoice = useVoice(audio ? voice : undefined)
  const rate = READING_RATE[readingSpeed] ?? 1.0

  const visible = filterBySlot(appointments, now)
  const activeIndex = findActiveIndex(visible, now)
  const activeAppointment = visible[activeIndex]
  const nextIndex =
    activeIndex >= 0 ? activeIndex + 1 : visible.findIndex((a) => new Date(a.start_at) > now)
  const nextAppointment = visible[nextIndex]

  const cardSize = rowSize
    ? Math.min(
        Math.floor((rowSize.width - CARD_GAP * (visible.length - 1) - 96) / (visible.length || 1)),
        Math.floor(rowSize.height * 0.65),
      )
    : 150

  useTTS(
    activeAppointment,
    nextAppointment,
    loading,
    onShutdownRequest,
    onModuleDone,
    dayName,
    periodLabel,
    audio,
    rate,
    visible.length > 0,
    ttsVoice,
  )

  useEffect(() => {
    if (!rowRef.current || activeIndex < 0) return
    const el = rowRef.current
    const scrollTarget = activeIndex * (cardSize + CARD_GAP) + cardSize / 2 - el.clientWidth / 2
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({
      left: Math.max(0, scrollTarget),
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [activeIndex, cardSize, rowRef])

  if (loading) return <StatusScreen text="Lade Termine..." />
  if (error) return <StatusScreen text={`Fehler: ${error}`} role="alert" />

  return (
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        outline: `6px solid ${DAY_OUTLINE_COLORS[now.getDay()]}`,
        outlineOffset: '-6px',
        boxSizing: 'border-box',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
          px: 6,
          pt: 4,
          pb: 4,
          flexShrink: 0,
        }}
      >
        <Typography
          component="h1"
          sx={{
            position: 'absolute',
            left: '48px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontFamily: FONT,
            fontSize: '1.8rem',
            fontWeight: 400,
            color: 'black',
            lineHeight: 1,
            m: 0,
          }}
        >
          Tagesroutine
        </Typography>
        <Typography
          component="h2"
          sx={{
            fontFamily: FONT,
            fontSize: '5rem',
            fontWeight: 700,
            color: 'black',
            lineHeight: 1,
            m: 0,
          }}
        >
          {dayName}
        </Typography>
        <Typography
          sx={{
            position: 'absolute',
            right: '48px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontFamily: FONT,
            fontSize: '2rem',
            fontWeight: 400,
            color: 'black',
            lineHeight: 1,
            m: 0,
          }}
        >
          {periodLabel}
        </Typography>
      </Box>

      <Box
        ref={rowRef}
        role="list"
        aria-label="Termine"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 6,
          gap: `${CARD_GAP}px`,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {visible.length === 0 ? (
          <Typography role="status" sx={{ fontFamily: FONT, fontSize: '2rem', color: 'grey.700' }}>
            Keine Termine
          </Typography>
        ) : (
          visible.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              isActive={a.id === activeAppointment?.id}
              isPast={a.id !== activeAppointment?.id && new Date(a.end_at) <= now}
              dayColor={dayColor}
              size={cardSize}
              animated={true}
            />
          ))
        )}
      </Box>
    </Box>
  )
}

export default Routine
