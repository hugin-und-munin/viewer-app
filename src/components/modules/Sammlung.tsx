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

const BACKGROUND_FADE_MS = 4000

// Fades an already-playing element's volume down to 0 over `ms`, then
// pauses it and restores full volume (so its next play() starts normally).
// A background track cutting off dead on every module switch is jarring —
// this gives it a quick, graceful exit instead. No-op straight to onDone
// if the element isn't actually playing (nothing to fade).
//
// Plain setInterval, not requestAnimationFrame — this call gates the whole
// module scheduler (onDone is what eventually calls onModuleDone), and rAF
// only promises to fire while the page is actually painting. There's
// nothing visual here to synchronize with, so there's no reason to depend
// on that at all — a stalled rAF would otherwise wedge the scheduler on
// this module until its 2-minute shutdown watchdog forces it forward.
function fadeOutAndPause(el: HTMLAudioElement, ms: number, onDone: () => void): void {
  if (el.paused) {
    onDone()
    return
  }
  const startVolume = el.volume
  const stepMs = 50
  const totalSteps = Math.max(1, Math.round(ms / stepMs))
  let step = 0
  const intervalId = setInterval(() => {
    step++
    el.volume = Math.max(0, startVolume * (1 - step / totalSteps))
    if (step >= totalSteps) {
      clearInterval(intervalId)
      el.pause()
      el.volume = startVolume
      onDone()
    }
  }, stepMs)
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

// In-memory truth for the running app process — set synchronously, so it's
// immediately visible to a component that remounts moments later (e.g. the
// control panel's "load" command re-showing the same module: showModule()
// mints a fresh instanceId on every call, forcing a real unmount+mount).
// The disk cache write below is asynchronous (an IPC round trip plus file
// I/O), so without this, a quick remount can read the file before the
// previous instance's write has landed and resume at the same item all
// over again. Disk is still needed as the source of truth across an actual
// app restart, where this map is gone too — that gap is unavoidable (no
// way to make a disk write instant), but same-process remounts no longer
// have any race window at all.
const sessionLastShown = new Map<string, string>()

// Identifies the last-shown item by its stable id, not its array position —
// `items` is re-sorted by `position` on every load, so a plain numeric
// index silently points at a different item once anything gets reordered
// in content-app. An id survives that; an index doesn't.
async function readCachedItemId(cacheKey: string): Promise<string | null> {
  if (sessionLastShown.has(cacheKey)) return sessionLastShown.get(cacheKey)!
  if (!window.electronAPI || !cacheKey) return null
  try {
    const raw = await window.electronAPI.cacheRead(POSITION_CACHE_FILE)
    if (!raw) return null
    const map = JSON.parse(raw) as Record<string, string>
    return map[cacheKey] ?? null
  } catch {
    return null
  }
}

async function writeCachedItemId(cacheKey: string, itemId: string): Promise<void> {
  sessionLastShown.set(cacheKey, itemId)
  if (!window.electronAPI || !cacheKey) return
  try {
    const raw = await window.electronAPI.cacheRead(POSITION_CACHE_FILE)
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    map[cacheKey] = itemId
    await window.electronAPI.cacheWrite(POSITION_CACHE_FILE, JSON.stringify(map))
  } catch {
    // best-effort — losing the on-disk position just resumes at item 1
    // after a real app restart; sessionLastShown above still protects
    // same-session remounts regardless of whether this disk write works.
  }
}

// Shared by ImageMode and AudioMode: an index that starts from wherever this
// mode+collection last left off and writes itself back to the cache on
// every change. Also reports `ready` — false until the cached value has
// been checked — so callers can hold off starting playback on index 0
// until they know whether 0 is actually right; otherwise the true starting
// item could briefly play/show before snapping to the resumed one.
function useCachedIndex(cacheKey: string, items: SammlungItem[]) {
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const itemCount = items.length
  const currentId = items[index]?.id

  useEffect(() => {
    let settled = false

    function resolve(cachedId: string | null) {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      // The cached id is whatever was on screen the moment we last
      // stopped — written the instant playback moved onto it, not once it
      // finished. A crash/reload/shutdown mid-display leaves that same
      // item cached, so resuming at it verbatim replays what was already
      // showing. Resume one past its *current* position instead — found
      // by id, not by trusting the old index, since a reorder in
      // content-app changes which item any given index points at. Worst
      // case (interruption landed in the brief gap between items) skips
      // an item that hadn't started yet, which is far less noticeable
      // than guaranteed repeats.
      if (cachedId) {
        const pos = items.findIndex((i) => i.id === cachedId)
        if (pos !== -1 && itemCount > 0) setIndex((pos + 1) % itemCount)
      }
      setReady(true)
    }

    readCachedItemId(cacheKey).then(resolve)
    // Safety net: a cache read that hangs or never resolves must not block
    // playback forever — that's a strictly worse regression than the cosmetic
    // issue this cache is fixing. Worst case, this just falls back to
    // starting at index 0, exactly like before the cache existed.
    const timeoutId = setTimeout(() => resolve(null), 800)

    return () => {
      settled = true
      clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready || !currentId) return
    writeCachedItemId(cacheKey, currentId)
  }, [ready, cacheKey, currentId])

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
  const [index, setIndex, ready] = useCachedIndex(`audio:${backgroundCollection}`, items)
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
  const [index, setIndex, ready] = useCachedIndex(`audio:${collection}`, items)
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
  const [index, setIndex, ready] = useCachedIndex(`image:${collection}`, items)

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
      // A caption gets a "let it finish" grace period (below) — captions
      // and the background playlist are mutually exclusive (imageAudioMode
      // is 'caption' XOR 'playlist'), so the playlist is never actually
      // playing while one is capturing anyway.
      if (capturingRef.current) {
        interruptDoneRef.current = () => onModuleDoneRef.current?.()
        return
      }
      // Fade the background track out instead of cutting it dead — still
      // reports done once the fade completes (not before), so the next
      // module can't start its own audio while this one's is still
      // sounding. No-op straight to onModuleDone if nothing's playing.
      const bgAudio = backgroundAudioRef.current
      if (bgAudio) {
        fadeOutAndPause(bgAudio, BACKGROUND_FADE_MS, () => onModuleDoneRef.current?.())
      } else {
        onModuleDoneRef.current?.()
      }
    })
  }, [onShutdownRequest, backgroundAudioRef])

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
