import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import type { RoutineProps } from '../../types/modules'
import { speak, stop, isSpeaking, PAUSE, PAUSE_SHORT, type TtsVoice } from '../../utils/tts'
import { getApi } from '../../api/api'
import { DAY_COLORS, DAY_OUTLINE_COLORS, DAY_OUTLINE_WIDTH, DAY_NAMES } from '../../utils/dayColors'
import { useMediaBlobUrl } from '../../utils/useMediaBlobUrl'

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Atkinson Hyperlegible', sans-serif"

const READING_RATE: Record<string, number> = {
  slow: 0.5,
  normal: 0.7,
  fast: 1,
}
const PAUSE_MS: Record<string, number> = { short: 1000, medium: 2000, long: 4000 }
const REPEAT_GAP_MS: Record<string, number> = { short: 3000, medium: 6000, long: 10000 }

const MORNING_START = 8
const MORNING_END = 12
const AFTERNOON_END = 20
const EVENING_END = 24
const CARD_GAP = 16
const PAST_ALPHA = 0.3
const FUTURE_ALPHA = 0.6
const PAST_TEXT = '#424242'

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

function toLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminanceOf(hex: string): number {
  const [r, g, b] = parseHex(hex)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function blendOnWhite(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return (
    '#' +
    [r, g, b]
      .map((c) =>
        Math.round(c * alpha + 255 * (1 - alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

function darkenForWhiteText(hex: string): string {
  for (let amount = 0; amount <= 200; amount += 5) {
    const darkened = darkenColor(hex, amount)
    if (1.05 / (luminanceOf(darkened) + 0.05) >= 4.5) return darkened
  }
  return darkenColor(hex, 200)
}

function resolveAccessiblePastBgColor(dayColor: string): string {
  for (let a = Math.round(PAST_ALPHA * 100); a >= 0; a--) {
    const alpha = a / 100
    const bg = blendOnWhite(dayColor, alpha)
    const L1 = luminanceOf(PAST_TEXT)
    const L2 = luminanceOf(bg)
    const lighter = Math.max(L1, L2)
    const darker = Math.min(L1, L2)
    if ((lighter + 0.05) / (darker + 0.05) >= 3) return hexToRgba(dayColor, alpha)
  }
  return hexToRgba(dayColor, 0)
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

// Unlike filterBySlot, not bounded to the current morning/afternoon/evening
// window — the simple mode's "next appointment" must still be found even
// right after a slot boundary (e.g. 11:55 looking for a 12:05 appointment).
function filterToday(appointments: Appointment[], now: Date): Appointment[] {
  const todayStr = now.toISOString().slice(0, 10)
  return appointments.filter((a) => new Date(a.start_at).toISOString().slice(0, 10) === todayStr)
}

function findActiveIndex(appointments: Appointment[], now: Date): number {
  return appointments.findIndex((a) => now >= new Date(a.start_at) && now < new Date(a.end_at))
}

function findNextIndex(appointments: Appointment[], activeIndex: number, now: Date): number {
  return activeIndex >= 0
    ? activeIndex + 1
    : appointments.findIndex((a) => new Date(a.start_at) > now)
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

// Title/time → its own description is a fixed short pause (PAUSE_SHORT) —
// closely related content that shouldn't stretch out with the "long" setting
// the way the bigger topic changes (greeting → intro → active → next) do.
function buildTTSText(
  active: Appointment | undefined,
  next: Appointment | undefined,
  dayName: string,
  periodLabel: string,
): string {
  const now = new Date()
  const parts = [getGreeting(now), PAUSE, `Hier ist deine Tagesroutine für ${dayName} ${periodLabel}.`, PAUSE]

  if (active) {
    parts.push(
      `Du befindest dich gerade bei: ${breakOrdinal(active.title)}, von ${formatTime(active.start_at)} bis ${formatTime(active.end_at)}.`,
    )
    if (active.description) parts.push(PAUSE_SHORT, breakOrdinal(active.description))
  } else {
    parts.push('Momentan ist kein Termin aktiv.')
  }

  if (next) {
    parts.push(PAUSE, `Als nächstes folgt: ${breakOrdinal(next.title)}.`)
    if (next.description) parts.push(PAUSE_SHORT, breakOrdinal(next.description))
  }

  return parts.join('')
}

function roundToNearest5Minutes(date: Date): Date {
  const ms = 5 * 60 * 1000
  return new Date(Math.round(date.getTime() / ms) * ms)
}

// Simple mode: short, easy-to-follow announcement — no time ranges, no
// mention of "nothing active right now" (goes straight to what's next).
function buildSimpleTTSText(active: Appointment | undefined, next: Appointment | undefined, dayName: string): string {
  const now = new Date()
  const roundedTime = formatTime(roundToNearest5Minutes(now).toISOString())
  const parts = ['Hier ist deine Tagesroutine.', PAUSE, `Es ist ${dayName}, ${roundedTime}.`]

  if (!active && !next) {
    parts.push(PAUSE, 'Für heute sind keine weiteren Termine geplant.')
    return parts.join('')
  }

  if (active) {
    parts.push(PAUSE, `Du befindest dich gerade bei: ${breakOrdinal(active.title)}.`)
    if (active.description) parts.push(PAUSE_SHORT, breakOrdinal(active.description))
  }

  if (next) {
    parts.push(PAUSE, `Um ${formatTime(next.start_at)} folgt: ${breakOrdinal(next.title)}.`)
    if (next.description) parts.push(PAUSE_SHORT, breakOrdinal(next.description))
  }

  return parts.join('')
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useAppointments(moduleId: string) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getApi()
      .get<ModuleDataEntry[]>(`/modules/${moduleId}/data`, { ttl: 0 })
      .then((entries) => {
        console.log(`[Routine] module_data for ${moduleId}:`, entries)
        return entries
      })
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
  mode: 'overview' | 'simple',
  pauseMs: number,
  repeat: boolean,
  repeatGapMs: number,
  voice?: TtsVoice,
) {
  const interruptDoneRef = useRef<(() => void) | null>(null)

  const paramsRef = useRef({
    active,
    next,
    rate,
    voice,
    hasAppointments,
    mode,
    pauseMs,
    repeat,
    repeatGapMs,
    onModuleDone,
  })
  useEffect(() => {
    paramsRef.current = {
      active,
      next,
      rate,
      voice,
      hasAppointments,
      mode,
      pauseMs,
      repeat,
      repeatGapMs,
      onModuleDone,
    }
  }, [active, next, rate, voice, hasAppointments, mode, pauseMs, repeat, repeatGapMs, onModuleDone])

  useEffect(() => {
    onShutdownRequest?.(() => {
      if (isSpeaking()) {
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
      mode: m,
      pauseMs: p,
      repeat: rep,
      repeatGapMs: rg,
      onModuleDone: done,
    } = paramsRef.current
    const text = m === 'simple' ? buildSimpleTTSText(a, n, dayName) : buildTTSText(a, n, dayName, periodLabel)

    let repeated = false
    let repeatTimer: ReturnType<typeof setTimeout> | null = null

    function playOnce() {
      speak(text, { rate: r, voice: v, pauseMs: p, onEnd: handleEnd })
    }

    function handleEnd() {
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
        return
      }
      if (rep && !repeated) {
        repeated = true
        repeatTimer = setTimeout(playOnce, rg)
      } else if (!has) {
        done?.()
      }
    }

    playOnce()

    return () => {
      if (repeatTimer) clearTimeout(repeatTimer)
      stop()
    }
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

// Finds the largest font size that fits the card without overflowing in
// either dimension — starts near the full box size and shrinks only as much
// as this specific text at this specific (screen-dependent) box size
// actually needs, rather than capping at a fixed fraction of the box. That
// fixed-fraction approach left big cards under-filled and could still clip
// small ones, since it never adapted to what actually fit.
function useFitFontSize(text: string, boxSize: number, minPx = 8) {
  const ref = useRef<HTMLElement>(null)
  const [fontSize, setFontSize] = useState(boxSize)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !el.parentElement) return
    const parent = el.parentElement
    const heightLimit = parent.clientHeight
    const widthLimit = parent.clientWidth
    let size = Math.round(boxSize * 0.9)
    el.style.fontSize = `${size}px`
    while (size > minPx && (el.scrollHeight > heightLimit || el.scrollWidth > widthLimit)) {
      size -= 1
      el.style.fontSize = `${size}px`
    }
    setFontSize(size)
  }, [text, boxSize, minPx])

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
  const bgColor = isActive
    ? darkenForWhiteText(dayColor)
    : isPast
      ? resolveAccessiblePastBgColor(dayColor)
      : hexToRgba(dayColor, FUTURE_ALPHA)

  const { ref: textRef, fontSize } = useFitFontSize(appointment.title, size)
  const { url: iconUrl } = useMediaBlobUrl(appointment.icon)

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
        // Deliberately excludes width/height: animating those races the
        // text-fit measurement below, which reads clientHeight/clientWidth
        // synchronously right after a size change — mid-transition, that
        // read would land on an intermediate (not yet final) box size.
        transition: animated
          ? 'background-color 0.3s ease, border-radius 0.3s ease, transform 0.3s ease, margin 0.3s ease, box-shadow 0.3s ease'
          : 'none',
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none !important',
        },
        px: iconUrl ? 0 : isActive ? 0 : 1,
        overflow: 'hidden',
      }}
    >
      {iconUrl ? (
        <Box
          component="img"
          src={iconUrl}
          alt=""
          aria-hidden="true"
          sx={{
            width: `${Math.round(size * 0.92)}px`,
            height: `${Math.round(size * 0.92)}px`,
            objectFit: 'contain',
            // Match the card's own shape so a non-square image's corners
            // don't stick out past the circular (isActive) mask.
            borderRadius: isActive ? '50%' : `${size * 0.1}px`,
          }}
        />
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

const SIMPLE_GAP = 48

// Featured (currently-active, or the upcoming one if nothing's active) and
// the "next" card sit side by side, sized to fill the available area — same
// shape/color/icon-or-title treatment as AppointmentCard, just larger.
// Whether something is active or merely upcoming is conveyed by that card
// styling alone (no separate time caption needed on screen; exact timing is
// still spoken in the TTS text).
function computeSimpleCardSizes(
  containerSize: { width: number; height: number } | null,
  showNextCard: boolean,
): { featuredSize: number; nextSize: number } {
  if (!containerSize) return { featuredSize: 340, nextSize: 160 }
  const maxHeight = Math.floor(containerSize.height * 0.85)
  if (!showNextCard) {
    return { featuredSize: Math.min(Math.floor(containerSize.width * 0.55), maxHeight), nextSize: 0 }
  }
  const unit = Math.floor((containerSize.width - SIMPLE_GAP) / 3)
  return {
    featuredSize: Math.min(unit * 2, maxHeight),
    nextSize: Math.min(unit, Math.floor(maxHeight * 0.6)),
  }
}

function SimpleView({
  active,
  next,
  dayColor,
}: {
  active: Appointment | undefined
  next: Appointment | undefined
  dayColor: string
}) {
  const featured = active ?? next
  const isActive = !!active
  const showNextCard = isActive && !!next
  const { ref, size: containerSize } = useRowSize(false)

  if (!featured) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography
          role="status"
          sx={{ fontFamily: FONT, fontSize: '2rem', color: 'grey.700', textAlign: 'center', px: 6 }}
        >
          Für heute sind keine weiteren Termine geplant.
        </Typography>
      </Box>
    )
  }

  const { featuredSize, nextSize } = computeSimpleCardSizes(containerSize, showNextCard)

  return (
    <Box
      ref={ref}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: `${SIMPLE_GAP}px`,
        px: 6,
      }}
    >
      <AppointmentCard
        appointment={featured}
        isActive={isActive}
        isPast={false}
        dayColor={dayColor}
        size={featuredSize}
        animated={true}
      />
      {showNextCard && next && (
        <AppointmentCard
          appointment={next}
          isActive={false}
          isPast={false}
          dayColor={dayColor}
          size={nextSize}
          animated={true}
        />
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
  pause = 'medium',
  repeat = false,
  mode = 'overview',
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
  const ttsVoice = audio ? voice : undefined
  const rate = READING_RATE[readingSpeed] ?? 1.0
  const pauseMs = PAUSE_MS[pause] ?? 0
  const repeatGapMs = REPEAT_GAP_MS[pause] ?? 0

  const visible = filterBySlot(appointments, now)
  const activeIndex = findActiveIndex(visible, now)
  const activeAppointment = visible[activeIndex]
  const nextIndex = findNextIndex(visible, activeIndex, now)
  const nextAppointment = visible[nextIndex]

  // Simple mode isn't bounded to the current half-day slot — it looks at all
  // of today's appointments so "next" is still found right after a slot boundary.
  const todayAppointments = filterToday(appointments, now)
  const todayActiveIndex = findActiveIndex(todayAppointments, now)
  const todayActiveAppointment = todayAppointments[todayActiveIndex]
  const todayNextIndex = findNextIndex(todayAppointments, todayActiveIndex, now)
  const todayNextAppointment = todayAppointments[todayNextIndex]

  const isSimple = mode === 'simple'
  const ttsActive = isSimple ? todayActiveAppointment : activeAppointment
  const ttsNext = isSimple ? todayNextAppointment : nextAppointment
  const hasAppointments = isSimple ? !!ttsActive || !!ttsNext : visible.length > 0

  const cardSize = rowSize
    ? Math.min(
        Math.floor((rowSize.width - CARD_GAP * (visible.length - 1) - 96) / (visible.length || 1)),
        Math.floor(rowSize.height * 0.65),
      )
    : 150

  useTTS(
    ttsActive,
    ttsNext,
    loading,
    onShutdownRequest,
    onModuleDone,
    dayName,
    periodLabel,
    audio,
    rate,
    hasAppointments,
    mode,
    pauseMs,
    repeat,
    repeatGapMs,
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
        outline: `${DAY_OUTLINE_WIDTH} solid ${DAY_OUTLINE_COLORS[now.getDay()]}`,
        outlineOffset: `-${DAY_OUTLINE_WIDTH}`,
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
        {!isSimple && (
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
        )}
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
        {!isSimple && (
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
        )}
      </Box>

      {isSimple ? (
        <SimpleView active={todayActiveAppointment} next={todayNextAppointment} dayColor={dayColor} />
      ) : (
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
      )}
    </Box>
  )
}

export default Routine
