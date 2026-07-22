import { loadConfig } from '../api/deviceConfig'
import { getTokenManager } from '../api/tokenManager'

export type LogLevel = 'info' | 'warn' | 'error'
export type LogSource = 'app' | 'module' | 'lifecycle' | 'control' | 'storage'

interface LogEvent {
  level: LogLevel
  source: LogSource
  moduleType?: string
  message: string
}

interface QueuedEvent {
  level: LogLevel
  source: LogSource
  module_type: string | null
  message: string
  occurred_at: string
}

const QUEUE_FILE = 'pending-device-logs.json'
const MAX_QUEUE_SIZE = 200
const SEND_TIMEOUT_MS = 5000

let queue: QueuedEvent[] = []
let queueReady: Promise<void> | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let flushing = false

async function loadQueue(): Promise<void> {
  if (!window.electronAPI) return
  try {
    const raw = await window.electronAPI.cacheRead(QUEUE_FILE)
    if (raw) queue = JSON.parse(raw) as QueuedEvent[]
  } catch {
    queue = []
  }
}

function ensureQueueLoaded(): Promise<void> {
  if (!queueReady) queueReady = loadQueue()
  return queueReady
}

function saveQueue(): void {
  if (!window.electronAPI) return
  clearTimeout(saveTimer)
  // Debounced like Api's response cache (api.ts) — batches rapid successive writes.
  saveTimer = setTimeout(() => {
    window.electronAPI!.cacheWrite(QUEUE_FILE, JSON.stringify(queue)).catch(() => {})
  }, 500)
}

// Posts a single event directly (no queuing) — used both for the immediate-send
// path and for draining the persisted queue.
async function sendOne(event: QueuedEvent): Promise<boolean> {
  try {
    const { apiUrl } = await loadConfig()
    const { deviceId, accessToken } = await getTokenManager().getToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    try {
      const res = await fetch(`${apiUrl}/devices/${deviceId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(event),
        signal: controller.signal,
      })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

// Sends queued events in order (oldest first). Stops at the first failure —
// assumes connectivity is still down — and persists whatever remains.
// Returns true only if the whole queue drained successfully.
export async function flushQueue(): Promise<boolean> {
  if (flushing) return false
  flushing = true
  try {
    await ensureQueueLoaded()
    while (queue.length > 0) {
      const ok = await sendOne(queue[0])
      if (!ok) {
        saveQueue()
        return false
      }
      queue.shift()
    }
    saveQueue()
    return true
  } finally {
    flushing = false
  }
}

// Fire-and-forget: reporting a log event must never throw into the caller,
// so a broken module or a network hiccup can't crash the app. Events are
// queued to disk first so they survive an offline period, then an immediate
// flush is attempted.
export function logEvent({ level, source, moduleType, message }: LogEvent): void {
  void (async () => {
    await ensureQueueLoaded()
    queue.push({
      level,
      source,
      module_type: moduleType ?? null,
      message,
      occurred_at: new Date().toISOString(),
    })
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE)
    saveQueue()
    flushQueue().catch(() => {})
  })()
}
