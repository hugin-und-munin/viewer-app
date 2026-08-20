import { getApi } from '../api/api'
import { loadConfig, loadDeviceConfig } from '../api/deviceConfig'
import { reportStorageFailure } from '../logging/storageMonitor'

interface ModuleDataEntry {
  data: Record<string, unknown>
}

interface UserProfile {
  media_id?: string | null
}

interface AppSettingsSummary {
  id: string
  valid_from: string
  valid_to: string | null
}

interface AppSettingsDetail {
  id: string
  modules: unknown[]
}

interface ApiModule {
  id: string
}

const PREFETCH_DATE_FILE = 'prefetch-date.json'

// How many requests (media downloads, profile lookups, appsettings detail
// fetches) run at once during a prefetch. Unbounded here previously meant
// a single module with, say, 200 images fired all 200 downloads — and 200
// IPC round-trips (each with a base64 encode + disk write) — at the exact
// same instant, which is real load on both the API server and the
// Electron main process for no benefit (prefetch has no deadline; nothing
// is waiting on it). 10 is small enough that it reads as "a handful of
// ordinary requests" to the server rather than a burst, while still
// clearing a few hundred already-mostly-cached items well within a
// minute — ensureCached's own skip-if-cached check means most runs only
// do real work for the few items that are actually new.
const FETCH_CONCURRENCY = 10

// Runs `fn` over `items` with at most `limit` calls in flight at once — a
// small worker pool, no external dependency. Each worker just keeps
// pulling the next item off a shared index until the list is exhausted.
// Per-item failures are swallowed here (matching the previous
// Promise.allSettled behavior) so one bad item never stops the rest.
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      await fn(item).catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function prefetchModule(moduleId: string): Promise<void> {
  let entries: ModuleDataEntry[]
  try {
    entries = await getApi().get<ModuleDataEntry[]>(`/modules/${moduleId}/data`)
  } catch {
    return
  }

  const mediaIds = new Set<string>()
  const userIds = new Set<string>()

  for (const entry of entries) {
    if (typeof entry.data.media_id === 'string') mediaIds.add(entry.data.media_id)
    if (typeof entry.data.icon === 'string') mediaIds.add(entry.data.icon) // Routine appointment picture
    if (typeof entry.data.user_id === 'string') userIds.add(entry.data.user_id)
  }

  await mapWithConcurrency([...userIds], FETCH_CONCURRENCY, (id) =>
    getApi()
      .get<UserProfile>(`/users/${id}`)
      .then((user) => {
        if (user.media_id) mediaIds.add(user.media_id)
      }),
  )

  // ensureCached skips anything already on disk on its own — so a re-run
  // only does actual work for media that's newly appeared since last time.
  await mapWithConcurrency([...mediaIds], FETCH_CONCURRENCY, (id) =>
    getApi().ensureCached(`/media/${id}`),
  )
}

async function prefetchAppSettings(deviceId: string): Promise<void> {
  const { appsettingsLookaheadDays } = await loadConfig()
  let summaries: AppSettingsSummary[]
  try {
    summaries = await getApi().get<AppSettingsSummary[]>(`/devices/${deviceId}/appsettings`)
  } catch {
    return
  }

  const cutoff = new Date(Date.now() + appsettingsLookaheadDays * 24 * 60 * 60 * 1000)
  const now = new Date()
  const relevant = summaries.filter(
    (s) => new Date(s.valid_from) <= cutoff && (s.valid_to === null || new Date(s.valid_to) >= now),
  )

  await mapWithConcurrency(relevant, FETCH_CONCURRENCY, (s) =>
    getApi()
      .get<AppSettingsDetail>(`/devices/${deviceId}/appsettings/${s.id}`)
      .then(() => {}),
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function ranToday(): Promise<boolean> {
  if (!window.electronAPI) return false
  try {
    const raw = await window.electronAPI.cacheRead(PREFETCH_DATE_FILE)
    return !!raw && JSON.parse(raw).date === today()
  } catch {
    return false
  }
}

async function markDone(): Promise<void> {
  if (!window.electronAPI) return
  try {
    await window.electronAPI.cacheWrite(PREFETCH_DATE_FILE, JSON.stringify({ date: today() }))
  } catch {
    reportStorageFailure('prefetch-date-write', 'failed to write prefetch-date marker to disk')
  }
}

export async function prefetchAll(): Promise<void> {
  const { disablePrefetch } = await loadConfig()
  if (disablePrefetch) return
  if (await ranToday()) return

  const { deviceId } = await loadDeviceConfig()

  let modules: ApiModule[]
  try {
    modules = await getApi().get<ApiModule[]>('/modules')
  } catch {
    console.warn('[Prefetch] Server not reachable — skipping, will retry on next interval')
    return
  }

  await Promise.allSettled([
    ...modules.map((m) => prefetchModule(m.id)),
    prefetchAppSettings(deviceId),
  ]).then(() => markDone())
}
