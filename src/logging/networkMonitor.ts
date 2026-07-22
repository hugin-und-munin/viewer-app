import { logEvent, flushQueue } from './deviceLogger'

// Tracks connectivity to the api-server based on actual request outcomes
// (not navigator.onLine, which is unreliable in Electron/on captive networks).
// Logs only on state transitions so a prolonged outage doesn't flood the
// device_logs table with one entry per failed poll.
type State = 'online' | 'offline'

let state: State = 'online'

function markOffline(): void {
  if (state === 'offline') return
  state = 'offline'
  logEvent({ level: 'error', source: 'app', message: 'network connection lost' })
}

function markOnline(): void {
  if (state === 'online') return
  state = 'online'
  logEvent({ level: 'info', source: 'app', message: 'network connection restored' })
}

// Reaching the server at all — even with a non-2xx response — means the
// network path is up, so it counts as connectivity being restored.
export function reportSuccess(): void {
  const wasOffline = state === 'offline'
  markOnline()
  if (wasOffline) flushQueue().catch(() => {})
}

export function reportFailure(): void {
  markOffline()
}

// Separate from connectivity: a rejected client_secret looks identical to a
// network outage unless distinguished, but calls for a completely different
// fix (swap credentials vs. check the network) — so it gets its own state
// and message, logged only on transition just like connectivity above.
let authState: State = 'online'

export function reportAuthFailure(): void {
  if (authState === 'offline') return
  authState = 'offline'
  logEvent({ level: 'error', source: 'app', message: 'authentication failed — check device credentials' })
}

export function reportAuthSuccess(): void {
  if (authState === 'online') return
  authState = 'online'
  logEvent({ level: 'info', source: 'app', message: 'authentication recovered' })
}

// Safety net: retries the queue periodically even without a fresh signal,
// in case the app started while already offline or a flush was interrupted.
const SAFETY_NET_INTERVAL_MS = 2 * 60 * 1000
setInterval(() => {
  flushQueue()
    .then((ok) => {
      if (ok) markOnline()
    })
    .catch(() => {})
}, SAFETY_NET_INTERVAL_MS)
