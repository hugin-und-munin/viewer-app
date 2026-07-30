import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Avatar, Box, Typography } from '@mui/material'
import { getApi } from '../../api/api'
import type { ChatProps } from '../../types/modules'
import { speak, stop, isSpeaking, PAUSE, type TtsVoice } from '../../utils/tts'
import { useMediaBlobUrl } from '../../utils/useMediaBlobUrl'
import { READING_RATE, SHORT_PAUSE_MS, LONG_PAUSE_MS } from '../../utils/ttsPacing'

// ─── Constants ────────────────────────────────────────────────────────────────

const DISPLAY_MS = 5000
const DEFAULT_RECENT_MESSAGE_COUNT = 10
const FONT = "'Atkinson Hyperlegible', sans-serif"

// An image message's otherwise-unused `content` field doubles as an optional
// spoken caption — no backend/schema change needed. Plain content is caption
// text (spoken via TTS); content prefixed with this invisible marker instead
// references a separately-uploaded voice-caption recording's media ID (same
// "invisible Unicode marker" idiom as PAUSE/PAUSE_SHORT in utils/tts.ts).
// content-app must encode with this exact character.
const VOICE_CAPTION_PREFIX = '⁡' // Invisible Function Application

interface ImageCaption {
  text?: string
  voiceMediaId?: string
}

function parseImageCaption(content: string): ImageCaption | undefined {
  if (!content) return undefined
  if (content.startsWith(VOICE_CAPTION_PREFIX)) {
    const voiceMediaId = content.slice(VOICE_CAPTION_PREFIX.length)
    return voiceMediaId ? { voiceMediaId } : undefined
  }
  return { text: content }
}

const FONT_SIZE = {
  small: { header: '2rem', body: '1.8rem' },
  medium: { header: '3rem', body: '2.5rem' },
  large: { header: '4rem', body: '3.2rem' },
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageType = 'text' | 'image' | 'audio'

interface Message {
  id: string
  user_id: string
  username: string
  sender_media_id?: string
  content: string
  type: MessageType
  media_id?: string
  created_at: string
}

interface ModuleDataEntry {
  id: string
  module_id: string
  data: {
    user_id: string
    content: string
    type?: MessageType
    media_id?: string
  }
  created_at: string
  display_count: number
}

interface UserPublicProfile {
  id: string
  name: string | null
  media_id: string | null
}

// ─── Message selection ────────────────────────────────────────────────────────

// Takes the `count` most recent entries, then orders them for playback by
// display_count ascending (least-shown first) and created_at ascending as a
// tiebreaker (oldest of the equally-shown first) — a fair-rotation order.
function selectRecentEntries(entries: ModuleDataEntry[], count: number): ModuleDataEntry[] {
  const mostRecent = [...entries]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, count)
  return mostRecent.sort((a, b) => {
    if (a.display_count !== b.display_count) return a.display_count - b.display_count
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMessages(moduleId: string, recentMessageCount: number) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const entries = await getApi().get<ModuleDataEntry[]>(`/modules/${moduleId}/data`, {
          ttl: 0,
        })
        console.log(`[Chat] module_data for ${moduleId}:`, entries)
        if (cancelled) return

        const base = selectRecentEntries(entries, recentMessageCount).map((e) => ({
          id: e.id,
          user_id: e.data.user_id,
          username: '',
          sender_media_id: undefined as string | undefined,
          content: e.data.content,
          type: (e.data.type ?? 'text') as MessageType,
          media_id: e.data.media_id,
          created_at: e.created_at,
        }))

        const uniqueIds = [...new Set(base.map((m) => m.user_id).filter(Boolean))]
        const profileMap = new Map<string, UserPublicProfile>()
        await Promise.all(
          uniqueIds.map((id) =>
            getApi()
              .get<UserPublicProfile>(`/users/${id}`)
              .then((p) => profileMap.set(id, p))
              .catch(() => {}),
          ),
        )

        if (cancelled) return
        setMessages(
          base.map((m) => ({
            ...m,
            username: profileMap.get(m.user_id)?.name || 'Unbekannt',
            sender_media_id: profileMap.get(m.user_id)?.media_id ?? undefined,
          })),
        )
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [moduleId, recentMessageCount])

  return { messages, loading, error }
}

function useShutdownRequest(
  onShutdownRequest: ChatProps['onShutdownRequest'],
  onModuleDone: ChatProps['onModuleDone'],
  audioRef: React.RefObject<HTMLAudioElement | null>,
) {
  const interruptDoneRef = useRef<(() => void) | null>(null)
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])

  useEffect(() => {
    onShutdownRequest?.(() => {
      const ttsSpeaking = isSpeaking()
      const audioPlaying = audioRef.current != null && !audioRef.current.paused
      if (ttsSpeaking || audioPlaying) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest, audioRef])

  return interruptDoneRef
}

// Scrolls so the current reading position sits ~30% down from the bubble's
// top instead of flush against it — anchoring it flush would put the active
// line right at the scroll boundary, so it'd reach the edge and get pushed
// out of view sooner than it should. Shared by both the audio-driven scroll
// (speakMessage) and the silent auto-scroll (autoScrollBubble) so the two
// modes move identically.
function scrollToReadingPosition(el: HTMLDivElement, fraction: number): void {
  const scrollRange = el.scrollHeight - el.clientHeight
  const readingY = fraction * el.scrollHeight
  const target = readingY - 0.3 * el.clientHeight
  el.scrollTop = Math.min(Math.max(target, 0), scrollRange)
}

function speakMessage(
  msg: Message,
  onEnd: () => void,
  bubbleRef: React.RefObject<HTMLDivElement | null>,
  rate: number,
  voice: TtsVoice | undefined,
  pauseMs: number,
) {
  const prefix = `Nachricht von ${msg.username || 'Unbekannt'}.`
  let contentStartSec = 0
  speak(`${prefix}${PAUSE}${msg.content}`, {
    rate,
    voice,
    pauseMs,
    onEnd,
    // Exact second where the content segment (after "Nachricht von X." +
    // the pause) starts in the synthesized clip — reported by the main
    // process, which actually knows each segment's real duration, rather
    // than estimated on this end.
    onSegments: (starts) => {
      contentStartSec = starts[1] ?? 0
    },
    onProgress: (fraction, durationSec) => {
      const el = bubbleRef.current
      if (!el || el.scrollHeight <= el.clientHeight) return
      // The synthesized clip is one continuous recording of prefix + pause +
      // content, but the bubble only shows `content` — so raw playback
      // fraction runs ahead of what's actually visible; rescale it to the
      // content-only sub-range before mapping it onto the scrollbar.
      const contentDurationSec = durationSec - contentStartSec
      if (contentDurationSec <= 0) return
      const elapsedSec = fraction * durationSec
      const contentFraction = Math.min(
        Math.max((elapsedSec - contentStartSec) / contentDurationSec, 0),
        1,
      )
      scrollToReadingPosition(el, contentFraction)
    },
  })
}

// With audio off there's no speech timeline to sync scrolling against, but a
// long message still needs to become fully visible before the display timer
// advances — so scroll it top to bottom at a steady pace over that window,
// using the same anchored positioning as the audio-driven scroll above.
// Returns a function to cancel the animation early (message advanced/unmounted).
function autoScrollBubble(el: HTMLDivElement, durationMs: number): () => void {
  const scrollRange = el.scrollHeight - el.clientHeight
  if (scrollRange <= 0) return () => {}
  const start = performance.now()
  let rafId: number
  const tick = (now: number) => {
    const fraction = Math.min((now - start) / durationMs, 1)
    scrollToReadingPosition(el, fraction)
    if (fraction < 1) rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(rafId)
}

// Plays a blob URL through a shared <audio> element — used both for
// recorded voice messages and recorded voice captions on images.
function playAudioElement(
  el: HTMLAudioElement | null,
  url: string | null,
  onDone: () => void,
): void {
  if (!el || !url) {
    onDone()
    return
  }
  el.src = url
  el.currentTime = 0
  el.onended = onDone
  el.oncanplay = () => {
    el.oncanplay = null
    el.play().catch(onDone)
  }
  el.load()
}

// A flat DISPLAY_MS is fine for short text, but a long message needs
// proportionally more time to actually read — same idea as TTS taking longer
// to speak more words. ~180 wpm is a comfortably slow, accessible pace;
// `rate` (the module's Lesegeschwindigkeit) scales it the same way it scales
// speech, so "langsam"/"schnell" affects silent reading time too.
const READING_WORDS_PER_MINUTE = 180

function estimateReadingMs(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const minutesAtRate = words / (READING_WORDS_PER_MINUTE * rate)
  return Math.max(DISPLAY_MS, minutesAtRate * 60000)
}

function useMessagePlayback(params: {
  moduleId: string
  messages: Message[]
  loading: boolean
  audio: boolean
  rate: number
  ttsVoice?: TtsVoice
  pauseMs: number
  repeat: boolean
  repeatGapMs: number
  imageDurationMs: number
  bubbleRef: React.RefObject<HTMLDivElement | null>
  audioRef: React.RefObject<HTMLAudioElement | null>
  onShutdownRequest: ChatProps['onShutdownRequest']
  onModuleDone: ChatProps['onModuleDone']
}) {
  const {
    moduleId,
    messages,
    loading,
    audio,
    rate,
    ttsVoice,
    pauseMs,
    repeat,
    repeatGapMs,
    imageDurationMs,
    bubbleRef,
    audioRef,
    onShutdownRequest,
    onModuleDone,
  } = params
  const [index, setIndex] = useState(0)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopAutoScrollRef = useRef<(() => void) | null>(null)
  const interruptDoneRef = useShutdownRequest(onShutdownRequest, onModuleDone, audioRef)

  const rateRef = useRef(rate)
  const ttsVoiceRef = useRef(ttsVoice)
  const pauseMsRef = useRef(pauseMs)
  const repeatRef = useRef(repeat)
  const repeatGapMsRef = useRef(repeatGapMs)
  const imageDurationMsRef = useRef(imageDurationMs)
  useEffect(() => {
    rateRef.current = rate
  }, [rate])
  useEffect(() => {
    ttsVoiceRef.current = ttsVoice
  }, [ttsVoice])
  useEffect(() => {
    pauseMsRef.current = pauseMs
  }, [pauseMs])
  useEffect(() => {
    repeatRef.current = repeat
  }, [repeat])
  useEffect(() => {
    repeatGapMsRef.current = repeatGapMs
  }, [repeatGapMs])
  useEffect(() => {
    imageDurationMsRef.current = imageDurationMs
  }, [imageDurationMs])

  const currentMsg = messages[index]
  const currentMediaId = currentMsg?.media_id
  const { url: mediaBlobUrl, settled: mediaBlobSettled } = useMediaBlobUrl(currentMediaId)

  const currentCaption =
    currentMsg?.type === 'image' ? parseImageCaption(currentMsg.content) : undefined
  const { url: captionBlobUrl, settled: captionBlobSettled } = useMediaBlobUrl(
    currentCaption?.voiceMediaId,
  )

  const mediaBlobUrlRef = useRef<string | null>(null)
  const triggerAudioRef = useRef<(() => void) | null>(null)
  const captionBlobUrlRef = useRef<string | null>(null)
  const captionBlobSettledRef = useRef(false)
  const triggerCaptionRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    mediaBlobUrlRef.current = mediaBlobUrl
    if (mediaBlobUrl && triggerAudioRef.current) {
      const trigger = triggerAudioRef.current
      triggerAudioRef.current = null
      trigger()
    }
  }, [mediaBlobUrl])

  useEffect(() => {
    captionBlobUrlRef.current = captionBlobUrl
    captionBlobSettledRef.current = captionBlobSettled
    if ((captionBlobUrl || captionBlobSettled) && triggerCaptionRef.current) {
      const trigger = triggerCaptionRef.current
      triggerCaptionRef.current = null
      trigger()
    }
  }, [captionBlobUrl, captionBlobSettled])

  useEffect(() => {
    if (!mediaBlobSettled || loading || messages.length === 0 || index >= messages.length) return
    const msg = messages[index]
    if (!msg.media_id || mediaBlobUrl) return
    if (msg.type !== 'image' && msg.type !== 'audio') return
    triggerAudioRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    stop()
    setIndex((i) => i + 1)
  }, [mediaBlobSettled, index, messages, loading, mediaBlobUrl])

  useEffect(() => {
    if (loading || messages.length === 0 || index >= messages.length) return

    if (bubbleRef.current) bubbleRef.current.scrollTop = 0

    // Switches to the next message immediately — the pause happens before
    // that next message is read/played (see startTimer below), not by
    // leaving the just-finished message lingering on screen.
    const advance = () => {
      setIndex((i) => i + 1)
    }

    const onEnd = () => {
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
      } else {
        advance()
      }
    }

    const msg = messages[index]
    const name = msg.username || 'Unbekannt'

    getApi()
      .post(`/modules/${moduleId}/data/${msg.id}/shown`, {})
      .catch(() => {})

    function begin() {
      if (msg.type === 'text') {
        if (audio) {
          let textRepeated = false
          const handleSpeakEnd = () => {
            if (interruptDoneRef.current) {
              interruptDoneRef.current()
              interruptDoneRef.current = null
              return
            }
            if (repeatRef.current && !textRepeated) {
              textRepeated = true
              timerRef.current = setTimeout(
                () =>
                  speakMessage(
                    msg,
                    handleSpeakEnd,
                    bubbleRef,
                    rateRef.current,
                    ttsVoiceRef.current,
                    pauseMsRef.current,
                  ),
                repeatGapMsRef.current,
              )
            } else {
              advance()
            }
          }
          speakMessage(
            msg,
            handleSpeakEnd,
            bubbleRef,
            rateRef.current,
            ttsVoiceRef.current,
            pauseMsRef.current,
          )
        } else {
          const readingMs = estimateReadingMs(msg.content, rateRef.current)
          if (bubbleRef.current)
            stopAutoScrollRef.current = autoScrollBubble(bubbleRef.current, readingMs)
          timerRef.current = setTimeout(advance, readingMs)
        }
      } else if (msg.type === 'image') {
        const caption = currentCaption
        const hasCaption = !!(caption?.text || caption?.voiceMediaId)

        let captionRepeated = false
        const playCaption = (onDone: () => void) => {
          if (caption?.voiceMediaId) {
            playAudioElement(audioRef.current, captionBlobUrlRef.current, onDone)
          } else if (caption?.text) {
            speak(caption.text, {
              rate: rateRef.current,
              voice: ttsVoiceRef.current,
              onEnd: onDone,
            })
          } else {
            onDone()
          }
        }

        // The caption (text spoken via TTS, or a recorded voice clip) is the
        // sender's own content, not generic chrome like "Bild von X." — it
        // always plays, even with the module's Audioausgabe off.
        const startCaption = (onDone: () => void) => {
          if (
            caption?.voiceMediaId &&
            !captionBlobUrlRef.current &&
            !captionBlobSettledRef.current
          ) {
            triggerCaptionRef.current = () => playCaption(onDone)
          } else {
            playCaption(onDone)
          }
        }

        // Re-runs the whole thing on repeat — "Bild von X." announcement (if
        // audio) followed by the caption — same as how Sprachnachricht
        // re-announces itself on each repeat, not just the recording alone.
        const playImageSequence = () => {
          if (audio) {
            speak(`Bild von ${name}.`, {
              rate: rateRef.current,
              voice: ttsVoiceRef.current,
              onEnd: () => {
                if (hasCaption) {
                  startCaption(handleCaptionEnd)
                } else {
                  timerRef.current = setTimeout(onEnd, imageDurationMsRef.current)
                }
              },
            })
          } else if (hasCaption) {
            startCaption(handleCaptionEnd)
          } else {
            timerRef.current = setTimeout(advance, imageDurationMsRef.current)
          }
        }

        const handleCaptionEnd = () => {
          if (interruptDoneRef.current) {
            interruptDoneRef.current()
            interruptDoneRef.current = null
            return
          }
          if (repeatRef.current && !captionRepeated) {
            captionRepeated = true
            timerRef.current = setTimeout(playImageSequence, repeatGapMsRef.current)
          } else {
            timerRef.current = setTimeout(onEnd, imageDurationMsRef.current)
          }
        }

        playImageSequence()
      } else if (msg.type === 'audio') {
        const el = audioRef.current
        if (!el) return

        let audioRepeated = false

        const playAudio = (onDone: () => void) =>
          playAudioElement(el, mediaBlobUrlRef.current, onDone)

        const handlePlaybackEnd = () => {
          if (interruptDoneRef.current) {
            interruptDoneRef.current()
            interruptDoneRef.current = null
            return
          }
          // Repeat only makes sense paired with the spoken announcement —
          // without it (audio off), the recording just played once is enough.
          if (audio && repeatRef.current && !audioRepeated) {
            audioRepeated = true
            timerRef.current = setTimeout(doPlayback, repeatGapMsRef.current)
          } else {
            advance()
          }
        }

        const doPlayback = () => {
          if (audio) {
            speak(`Sprachnachricht von ${name}.`, {
              rate: rateRef.current,
              voice: ttsVoiceRef.current,
              onEnd: () => {
                timerRef.current = setTimeout(
                  () => playAudio(handlePlaybackEnd),
                  pauseMsRef.current,
                )
              },
            })
          } else {
            playAudio(handlePlaybackEnd)
          }
        }

        if (mediaBlobUrlRef.current) {
          doPlayback()
        } else {
          triggerAudioRef.current = doPlayback
        }
      } else {
        timerRef.current = setTimeout(advance, DISPLAY_MS)
      }
    }

    // Pause before this message is read/played — applies uniformly to every
    // message, including the first. The message is already visible on
    // screen at this point (advance() switched immediately); the silence
    // sits in front of the new message, not trailing after the old one.
    let startTimer: ReturnType<typeof setTimeout> | null = null
    if (audio) {
      startTimer = setTimeout(begin, repeatGapMsRef.current)
    } else {
      begin()
    }

    const audioEl = audioRef.current
    return () => {
      if (startTimer) clearTimeout(startTimer)
      triggerAudioRef.current = null
      if (timerRef.current) clearTimeout(timerRef.current)
      stopAutoScrollRef.current?.()
      if (audioEl) {
        audioEl.onended = null
        audioEl.oncanplay = null
        audioEl.onerror = null
        audioEl.pause()
        audioEl.src = ''
        audioEl.load()
      }
      stop()
    }
  }, [
    index,
    messages,
    loading,
    audio,
    bubbleRef,
    audioRef,
    interruptDoneRef,
    moduleId,
    currentCaption,
  ])

  return { index, mediaBlobUrl }
}

// ─── Theme ────────────────────────────────────────────────────────────────────

type ThemeColors = {
  bg: string
  text: string
  bubbleBg: string
  bubbleBorder: string
  bubbleText: string
}

const CHAT_COLORS: Record<'light' | 'dark', ThemeColors> = {
  light: {
    bg: 'white',
    text: 'black',
    bubbleBg: 'white',
    bubbleBorder: 'black',
    bubbleText: 'black',
  },
  dark: {
    bg: '#18181b',
    text: '#f4f4f5',
    bubbleBg: 'white',
    bubbleBorder: 'white',
    bubbleText: 'black',
  },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusScreen({
  text,
  colors,
  role = 'status',
}: {
  text: string
  colors: ThemeColors
  role?: 'status' | 'alert'
}) {
  return (
    <Box
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        bgcolor: colors.bg,
      }}
    >
      <Typography sx={{ fontFamily: FONT, fontSize: '2rem', color: colors.text }}>
        {text}
      </Typography>
    </Box>
  )
}

function SenderAvatar({
  username,
  senderMediaId,
  sx,
}: {
  username: string
  senderMediaId?: string
  sx?: object
}) {
  const { url: blobUrl } = useMediaBlobUrl(senderMediaId)
  return (
    <Avatar
      src={blobUrl ?? undefined}
      alt={username}
      sx={{
        width: 'clamp(12rem, 18vw, 22rem)',
        height: 'clamp(12rem, 18vw, 22rem)',
        fontSize: '6rem',
        fontFamily: FONT,
        flexShrink: 0,
        bgcolor: 'grey.300',
        color: 'grey.800',
        ...sx,
      }}
    >
      {!blobUrl && username.charAt(0).toUpperCase()}
    </Avatar>
  )
}

function ChatBubble({
  content,
  bubbleRef,
  bodyFontSize = '2.5rem',
  colors,
}: {
  content: string
  bubbleRef: React.RefObject<HTMLDivElement | null>
  bodyFontSize?: string
  colors: ThemeColors
}) {
  const isDark = colors.bubbleBorder === colors.bubbleBg
  return (
    <Box sx={{ flex: 1, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box
        ref={bubbleRef}
        sx={{
          bgcolor: colors.bubbleBg,
          color: colors.bubbleText,
          border: `4px solid ${colors.bubbleBorder}`,
          borderRadius: '24px',
          p: 5,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          boxSizing: 'border-box',
        }}
      >
        <Typography
          sx={{
            fontFamily: FONT,
            fontSize: bodyFontSize,
            lineHeight: 1.5,
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {content}
        </Typography>
      </Box>
      <svg
        aria-hidden="true"
        style={{
          display: 'block',
          marginTop: -4,
          marginLeft: 40,
          flexShrink: 0,
          ...(isDark ? { overflow: 'visible' } : {}),
        }}
        viewBox="0 0 28 22"
        width="28"
        height="22"
      >
        <path
          d="M 0 0 L 14 22 L 28 0 Z"
          fill={colors.bubbleBg}
          stroke={colors.bubbleBorder}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <rect x="-1" y="-1" width="30" height="5" fill={colors.bubbleBg} />
      </svg>
    </Box>
  )
}

function TextMessage({
  msg,
  bubbleRef,
  fontSize = 'medium',
  colors,
}: {
  msg: Message
  bubbleRef: React.RefObject<HTMLDivElement | null>
  fontSize?: keyof typeof FONT_SIZE
  colors: ThemeColors
}) {
  const sizes = FONT_SIZE[fontSize]
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        px: 'clamp(3rem, 7vw, 8rem)',
        bgcolor: colors.bg,
      }}
    >
      <Typography
        component="h1"
        sx={{
          fontFamily: FONT,
          fontSize: '5rem',
          fontWeight: 700,
          color: colors.text,
          pt: 4,
          pb: 4,
          flexShrink: 0,
        }}
      >
        Nachricht von {msg.username || 'Unbekannt'}
      </Typography>
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          pb: 6,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%' }}>
          <ChatBubble
            content={msg.content}
            bubbleRef={bubbleRef}
            bodyFontSize={sizes.body}
            colors={colors}
          />
          <Box
            sx={{
              flex: 1,
              height: '100%',
              containerType: 'size',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Sized off the container's own box (not vw/vh) so it's exactly
                half the row's width, but never taller than the row itself —
                width and height both resolve to whichever is smaller. */}
            <SenderAvatar
              username={msg.username || 'Unbekannt'}
              senderMediaId={msg.sender_media_id}
              sx={{
                width: 'min(100cqw, 100cqh)',
                height: 'min(100cqw, 100cqh)',
                fontSize: 'min(20cqw, 20cqh)',
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function ImageMessage({
  msg,
  blobUrl,
  colors,
}: {
  msg: Message
  blobUrl: string | null
  colors: ThemeColors
}) {
  const name = msg.username || 'Unbekannt'
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        px: 6,
        bgcolor: colors.bg,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          pt: 4,
          pb: 3,
          flexShrink: 0,
        }}
      >
        <SenderAvatar
          username={name}
          senderMediaId={msg.sender_media_id}
          sx={{
            width: 'clamp(3.5rem, 6vw, 5rem)',
            height: 'clamp(3.5rem, 6vw, 5rem)',
            fontSize: '2rem',
          }}
        />
        <Typography
          component="h1"
          sx={{
            fontFamily: FONT,
            fontSize: '3rem',
            fontWeight: 600,
            color: colors.text,
          }}
        >
          Bild von {name}
        </Typography>
      </Box>
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pb: 6,
          overflow: 'hidden',
        }}
      >
        {blobUrl && (
          <Box
            component="img"
            src={blobUrl}
            alt={`Bild von ${name}`}
            sx={{
              maxWidth: '100%',
              maxHeight: '100%',
              borderRadius: '24px',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        )}
      </Box>
    </Box>
  )
}

function AudioMessage({ msg, colors }: { msg: Message; colors: ThemeColors }) {
  const name = msg.username || 'Unbekannt'
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        px: 'clamp(3rem, 7vw, 8rem)',
        bgcolor: colors.bg,
      }}
    >
      <Typography
        component="h1"
        sx={{
          fontFamily: FONT,
          fontSize: '5rem',
          fontWeight: 700,
          color: colors.text,
          pt: 4,
          pb: 4,
          flexShrink: 0,
        }}
      >
        Sprachnachricht von {name}
      </Typography>
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          pb: 6,
        }}
      >
        {/* Avatar half mirrors the text message's bubble/avatar row (sized
            off its own box via container query units) so the sender avatar
            renders at the identical size in both. The icon keeps its
            original fixed size, just centered in its own half now. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', height: '100%' }}>
          <Box
            sx={{
              flex: 1,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Box
              sx={{
                color: colors.text,
                flexShrink: 0,
                width: 'clamp(12rem, 30vw, 24rem)',
                height: 'clamp(12rem, 30vw, 24rem)',
              }}
            >
              <svg
                aria-hidden="true"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
              </svg>
            </Box>
          </Box>
          <Box
            sx={{
              flex: 1,
              height: '100%',
              containerType: 'size',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SenderAvatar
              username={name}
              senderMediaId={msg.sender_media_id}
              sx={{
                width: 'min(100cqw, 100cqh)',
                height: 'min(100cqw, 100cqh)',
                fontSize: 'min(20cqw, 20cqh)',
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Chat({
  module_id,
  audio,
  voice,
  fontSize = 'medium',
  readingSpeed = 'normal',
  pause = 'medium',
  repeat = false,
  theme = 'light',
  recentMessageCount = DEFAULT_RECENT_MESSAGE_COUNT,
  imageDuration = 1,
  onShutdownRequest,
  onModuleDone,
}: ChatProps) {
  const { messages, loading, error } = useMessages(module_id, recentMessageCount)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const ttsVoice = audio ? voice : undefined
  const rate = READING_RATE[readingSpeed] ?? 1.0
  const pauseMs = SHORT_PAUSE_MS[pause] ?? 0
  const repeatGapMs = LONG_PAUSE_MS[pause] ?? 0
  const imageDurationMs = imageDuration * 60 * 1000
  const colors = CHAT_COLORS[theme]

  const { index, mediaBlobUrl } = useMessagePlayback({
    moduleId: module_id,
    messages,
    loading,
    audio,
    rate,
    ttsVoice,
    pauseMs,
    repeat,
    repeatGapMs,
    imageDurationMs,
    bubbleRef,
    audioRef,
    onShutdownRequest,
    onModuleDone,
  })

  useEffect(() => {
    if (!loading && (messages.length === 0 || index >= messages.length)) {
      onModuleDone?.()
    }
  }, [loading, messages.length, index, onModuleDone])

  if (loading) return <StatusScreen text="Lade Nachrichten..." colors={colors} />
  if (error && messages.length === 0)
    return <StatusScreen text={`Fehler: ${error}`} colors={colors} role="alert" />
  if (messages.length === 0 || index >= messages.length) return null

  const msg = messages[index]

  return (
    <>
      {/* Permanent audio element — never unmounts so playback isn't interrupted */}
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
      {msg.type === 'image' ? (
        <ImageMessage msg={msg} blobUrl={mediaBlobUrl} colors={colors} />
      ) : msg.type === 'audio' ? (
        <AudioMessage msg={msg} colors={colors} />
      ) : (
        <TextMessage msg={msg} bubbleRef={bubbleRef} fontSize={fontSize} colors={colors} />
      )}
    </>
  )
}

export default Chat
