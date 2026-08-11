import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { getApi } from '../../api/api'
import { speak, stop, type TtsVoice } from '../../utils/tts'
import { READING_RATE, SHORT_PAUSE_MS, LONG_PAUSE_MS } from '../../utils/ttsPacing'
import { useMediaBlobUrl } from '../../utils/useMediaBlobUrl'
import type { SammlungProps } from '../../types/modules'
import delfin from '../../assets/delfin.png'

// ─── Constants ────────────────────────────────────────────────────────────────

const FONT = "'Atkinson Hyperlegible', sans-serif"

// A photo fills the whole frame, so there's no chrome left to theme once an
// image is showing — fixed colours instead of a user-selectable dark/light
// mode (which brought nothing to a fullscreen photo).
const BG_COLOR = '#000'
const STATUS_TEXT_COLOR = '#f4f4f5'

// ─── Data ─────────────────────────────────────────────────────────────────────

interface SammlungItem {
  id: string
  type: 'image' | 'audio'
  collection: string
  title: string
  media_id: string
  caption_audio_id?: string
  caption_text?: string
  position: number
}

interface ModuleDataEntry {
  id: string
  data: Omit<SammlungItem, 'id'>
}

function useSammlungItems(moduleId: string) {
  const [items, setItems] = useState<SammlungItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getApi()
      .get<ModuleDataEntry[]>(`/modules/${moduleId}/data`, { ttl: 0 })
      .then((entries) => {
        if (cancelled) return
        setItems(
          entries.map((e) => ({ id: e.id, ...e.data })).sort((a, b) => a.position - b.position),
        )
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [moduleId])

  return { items, loading }
}

// Plays a blob URL through a shared <audio> element, same idea as Chat's own
// (private, not reusable from here) helper of the same name — recorded
// voice captions and the background playlist both just need "play this URL,
// tell me when it's truly done" via the native `ended` event.
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

// ─── Slideshow position cache (per collection, image mode only) ───────────────

// Same mechanism as core/cachePrefetcher.ts — a JSON file on disk, read and
// written via the Electron main process — so returning to a collection
// after another module has shown resumes on the next item instead of
// restarting at the first. Keyed by "kind:collection" (not module/instance
// or playback role) — kind is "image" or "audio", separating the two since
// an image collection and an audio collection can coincidentally share a
// name. An audio collection has exactly one position regardless of whether
// it's played standalone (mode: audio) or as a background playlist — both
// use the same "audio:collection" key, on purpose, so switching between the
// two ways of playing the same collection doesn't reset or fork progress.
const POSITION_CACHE_FILE = 'sammlung-positions.json'

async function readCachedPosition(cacheKey: string): Promise<number> {
  if (!window.electronAPI || !cacheKey) return 0
  try {
    const raw = await window.electronAPI.cacheRead(POSITION_CACHE_FILE)
    if (!raw) return 0
    const map = JSON.parse(raw) as Record<string, number>
    return map[cacheKey] ?? 0
  } catch {
    return 0
  }
}

async function writeCachedPosition(cacheKey: string, index: number): Promise<void> {
  if (!window.electronAPI || !cacheKey) return
  try {
    const raw = await window.electronAPI.cacheRead(POSITION_CACHE_FILE)
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    map[cacheKey] = index
    await window.electronAPI.cacheWrite(POSITION_CACHE_FILE, JSON.stringify(map))
  } catch {
    // best-effort — losing the cached position just resumes at item 1
  }
}

// Shared by ImageMode and AudioMode: an index that starts from wherever this
// mode+collection last left off and writes itself back to the cache on
// every change. Also reports `ready` — false until the cached value has
// been checked — so callers can hold off starting playback on index 0
// until they know whether 0 is actually right; otherwise the true starting
// item could briefly play/show before snapping to the resumed one.
function useCachedIndex(cacheKey: string, itemCount: number) {
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let settled = false

    function resolve(cached: number) {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      if (cached > 0 && cached < itemCount) setIndex(cached)
      setReady(true)
    }

    readCachedPosition(cacheKey).then(resolve)
    // Safety net: a cache read that hangs or never resolves must not block
    // playback forever — that's a strictly worse regression than the cosmetic
    // issue this cache is fixing. Worst case, this just falls back to
    // starting at index 0, exactly like before the cache existed.
    const timeoutId = setTimeout(() => resolve(0), 800)

    return () => {
      settled = true
      clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready) return
    writeCachedPosition(cacheKey, index)
  }, [ready, cacheKey, index])

  return [index, setIndex, ready] as const
}

// ─── Background playlist (image mode, imageAudioMode = "playlist") ────────────

// Owns its own track index, entirely independent of the image slideshow's —
// the whole point is that it keeps playing across image changes instead of
// restarting each time. Position is cached under "audio:backgroundCollection"
// — the same key AudioMode would use for that collection played standalone
// — so a given playlist has exactly one remembered position, whichever way
// it's currently being played.
function useBackgroundPlaylist(
  items: SammlungItem[],
  enabled: boolean,
  backgroundCollection: string,
) {
  const [index, setIndex, ready] = useCachedIndex(`audio:${backgroundCollection}`, items.length)
  // A single-track "playlist" wraps index back to the same 0 every time —
  // React then skips the re-render (unchanged primitive state), so `url`
  // below never changes either and playback would silently never restart.
  // playToken always changes, forcing the effect to re-fire regardless.
  const [playToken, setPlayToken] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const current = enabled ? items[index % Math.max(items.length, 1)] : undefined
  const { url, settled } = useMediaBlobUrl(current?.media_id)

  useEffect(() => {
    if (!enabled || !ready || !settled || items.length === 0) return
    playAudioElement(audioRef.current, url, () => {
      setIndex((i) => (i + 1) % items.length)
      setPlayToken((t) => t + 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, settled, url, playToken])

  useEffect(() => {
    if (!enabled) audioRef.current?.pause()
  }, [enabled])

  return audioRef
}

// ─── Status screen ──────────────────────────────────────────────────────────

function StatusScreen({ text }: { text: string }) {
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100vh',
        bgcolor: BG_COLOR,
      }}
    >
      <Typography sx={{ fontFamily: FONT, fontSize: '2rem', color: STATUS_TEXT_COLOR }}>
        {text}
      </Typography>
    </Box>
  )
}

// ─── Audio mode (mode = "audio") ───────────────────────────────────────────────

// No per-item visual content to show, so — per an explicit product decision —
// this just shows the same look as the idle screen (dolphin on blue) while
// the collection plays through as a simple looping playlist.
function AudioMode({
  items,
  collection,
  onShutdownRequest,
  onModuleDone,
}: {
  items: SammlungItem[]
  collection: string
  onShutdownRequest: SammlungProps['onShutdownRequest']
  onModuleDone: SammlungProps['onModuleDone']
}) {
  const [index, setIndex, ready] = useCachedIndex(`audio:${collection}`, items.length)
  // See useBackgroundPlaylist above — a single-item collection needs this
  // too, otherwise a one-track "playlist" plays once and goes silent.
  const [playToken, setPlayToken] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const current = items[index]
  const { url, settled } = useMediaBlobUrl(current?.media_id)

  const interruptDoneRef = useRef<(() => void) | null>(null)
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])

  useEffect(() => {
    onShutdownRequest?.(() => {
      const playing = audioRef.current != null && !audioRef.current.paused
      if (playing) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest])

  useEffect(() => {
    if (!ready || !settled) return
    playAudioElement(audioRef.current, url, () => {
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
        return
      }
      setIndex((i) => (i + 1) % items.length)
      setPlayToken((t) => t + 1)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settled, url, playToken])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100vh',
        bgcolor: '#1f6fb2',
      }}
    >
      <Box component="img" src={delfin} alt="" sx={{ height: '50vh', width: 'auto' }} />
      <audio ref={audioRef} preload="auto" style={{ display: 'none' }} />
    </Box>
  )
}

// ─── Image mode (mode = "image") ───────────────────────────────────────────────

function ImageMode({
  items,
  collection,
  imageDurationMs,
  imageAudioMode,
  showCaptionText,
  backgroundItems,
  backgroundCollection,
  voice,
  rate,
  pauseMs,
  repeat,
  repeatGapMs,
  onShutdownRequest,
  onModuleDone,
}: {
  items: SammlungItem[]
  collection: string
  imageDurationMs: number
  imageAudioMode: 'silent' | 'caption' | 'playlist'
  showCaptionText: boolean
  backgroundItems: SammlungItem[]
  backgroundCollection: string
  voice: TtsVoice
  rate: number
  pauseMs: number
  repeat: boolean
  repeatGapMs: number
  onShutdownRequest: SammlungProps['onShutdownRequest']
  onModuleDone: SammlungProps['onModuleDone']
}) {
  const [index, setIndex, ready] = useCachedIndex(`image:${collection}`, items.length)

  const current = items[index]
  const { url: imageUrl, settled: imageSettled } = useMediaBlobUrl(current?.media_id)
  const isVoiceCaption = imageAudioMode === 'caption' && !!current?.caption_audio_id
  const { url: captionAudioUrl, settled: captionAudioSettled } = useMediaBlobUrl(
    isVoiceCaption ? current?.caption_audio_id : undefined,
  )
  const captionAudioRef = useRef<HTMLAudioElement>(null)
  const backgroundAudioRef = useBackgroundPlaylist(
    backgroundItems,
    imageAudioMode === 'playlist',
    backgroundCollection,
  )

  const interruptDoneRef = useRef<(() => void) | null>(null)
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])
  // Whether a caption is actively playing right now — read by the shutdown
  // handler below, which otherwise has no way to know without re-deriving
  // the whole playback state machine.
  const capturingRef = useRef(false)

  useEffect(() => {
    onShutdownRequest?.(() => {
      if (capturingRef.current) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest])

  const advance = () => {
    if (interruptDoneRef.current) {
      interruptDoneRef.current()
      interruptDoneRef.current = null
      return
    }
    setIndex((i) => (i + 1) % items.length)
  }

  // Silent / playlist: image is up for exactly imageDurationMs, nothing to
  // wait on — the background playlist (if any) runs entirely on its own
  // clock via useBackgroundPlaylist above.
  useEffect(() => {
    if (!ready || imageAudioMode === 'caption') return
    const timer = setTimeout(advance, imageDurationMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, current?.id, imageAudioMode, imageDurationMs])

  // Image fetch genuinely failed (not just still loading) — skip ahead
  // rather than sitting on a blank screen for the image's whole duration,
  // same idea as Weather skipping to the next module on a fetch error.
  // Left alone in caption mode: a broken photo shouldn't cut off audio
  // that's otherwise playing fine (the caption effect below owns advancing
  // there).
  useEffect(() => {
    if (!ready) return
    if (imageAudioMode !== 'caption' && imageSettled && !imageUrl) advance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, imageSettled, imageUrl, imageAudioMode])

  // Caption: the image must stay up for at least imageDurationMs, but a
  // longer voice message or read-aloud text must never be cut short —
  // advancing only happens once BOTH the minimum time has elapsed AND the
  // caption (including one repeat, if enabled) has actually finished
  // playing, whichever settles last.
  useEffect(() => {
    if (!ready || imageAudioMode !== 'caption' || !current) return
    if (isVoiceCaption && !captionAudioSettled) return // wait for the blob before starting the clock

    let minTimeElapsed = false
    let captionFinished = !current.caption_text && !isVoiceCaption
    let repeated = false
    let repeatTimer: ReturnType<typeof setTimeout> | null = null

    function tryAdvance() {
      if (minTimeElapsed && captionFinished) advance()
    }

    function onCaptionEnd() {
      capturingRef.current = false
      if (interruptDoneRef.current) {
        interruptDoneRef.current()
        interruptDoneRef.current = null
        return
      }
      if (repeat && !repeated) {
        repeated = true
        repeatTimer = setTimeout(playCaption, repeatGapMs)
      } else {
        captionFinished = true
        tryAdvance()
      }
    }

    function playCaption() {
      capturingRef.current = true
      if (current!.caption_text) {
        speak(current!.caption_text, { voice, rate, pauseMs, onEnd: onCaptionEnd })
      } else if (isVoiceCaption) {
        playAudioElement(captionAudioRef.current, captionAudioUrl, onCaptionEnd)
      } else {
        onCaptionEnd()
      }
    }

    const minTimer = setTimeout(() => {
      minTimeElapsed = true
      tryAdvance()
    }, imageDurationMs)
    // Long pause before the first read-aloud too, same as Chat's own
    // per-message startTimer — it applies "including the first" message,
    // not just the gap before a repeat.
    const startTimer = setTimeout(playCaption, repeatGapMs)

    return () => {
      clearTimeout(minTimer)
      clearTimeout(startTimer)
      if (repeatTimer) clearTimeout(repeatTimer)
      stop()
      capturingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, current?.id, imageAudioMode, isVoiceCaption, captionAudioSettled])

  if (!current) return <StatusScreen text="Keine Bilder in dieser Sammlung" />

  return (
    <Box
      sx={{
        position: 'relative',
        width: '100%',
        height: '100vh',
        bgcolor: BG_COLOR,
        overflow: 'hidden',
      }}
    >
      {imageUrl && (
        <Box
          key={current.id}
          component="img"
          src={imageUrl}
          alt=""
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            animation: 'sammlungImageFadeIn 0.6s ease',
            '@keyframes sammlungImageFadeIn': {
              from: { opacity: 0 },
              to: { opacity: 1 },
            },
          }}
        />
      )}
      {imageAudioMode === 'caption' && showCaptionText && current.caption_text && (
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.55)',
            px: 6,
            py: 4,
          }}
        >
          <Typography
            sx={{
              fontFamily: FONT,
              color: '#fff',
              fontSize: '2rem',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            {current.caption_text}
          </Typography>
        </Box>
      )}
      <audio ref={captionAudioRef} preload="auto" style={{ display: 'none' }} />
      <audio ref={backgroundAudioRef} preload="auto" style={{ display: 'none' }} />
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function Sammlung({
  onShutdownRequest,
  onModuleDone,
  module_id,
  mode = 'image',
  collection = '',
  imageDuration = 1,
  imageAudioMode = 'silent',
  showCaptionText = false,
  backgroundCollection = '',
  voice = 'female',
  readingSpeed = 'normal',
  pause = 'long',
  repeat = true,
}: SammlungProps) {
  const { items, loading } = useSammlungItems(module_id)
  const rate = READING_RATE[readingSpeed] ?? 1.0
  const pauseMs = SHORT_PAUSE_MS[pause] ?? 0
  const repeatGapMs = LONG_PAUSE_MS[pause] ?? 0

  const relevant = items.filter((i) => i.type === mode && i.collection === collection)
  const backgroundItems = items
    .filter((i) => i.type === 'audio' && i.collection === backgroundCollection)
    .sort((a, b) => a.position - b.position)

  // Empty collection (or none picked yet) — nothing useful to show, so skip
  // straight to the next module instead of sitting on a status screen for
  // the module's whole duration. Same mechanism as a normal shutdown handoff.
  const onModuleDoneRef = useRef(onModuleDone)
  useEffect(() => {
    onModuleDoneRef.current = onModuleDone
  }, [onModuleDone])
  useEffect(() => {
    if (!loading && relevant.length === 0) onModuleDoneRef.current?.()
  }, [loading, relevant.length])

  if (loading) return <StatusScreen text="Lade Sammlung…" />
  if (relevant.length === 0) return <StatusScreen text="Keine Inhalte in dieser Sammlung" />

  if (mode === 'audio') {
    return (
      <AudioMode
        items={relevant}
        collection={collection}
        onShutdownRequest={onShutdownRequest}
        onModuleDone={onModuleDone}
      />
    )
  }

  return (
    <ImageMode
      items={relevant}
      collection={collection}
      imageDurationMs={imageDuration * 60_000}
      imageAudioMode={imageAudioMode}
      showCaptionText={showCaptionText}
      backgroundItems={backgroundItems}
      backgroundCollection={backgroundCollection}
      voice={voice as TtsVoice}
      rate={rate}
      pauseMs={pauseMs}
      repeat={repeat}
      repeatGapMs={repeatGapMs}
      onShutdownRequest={onShutdownRequest}
      onModuleDone={onModuleDone}
    />
  )
}

export default Sammlung
