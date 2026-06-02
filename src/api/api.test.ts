import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Api } from './api'

// Mock loadConfig so tests don't touch Electron IPC
vi.mock('./deviceConfig', () => ({
  loadConfig: vi.fn(),
}))
import { loadConfig } from './deviceConfig'
const mockLoadConfig = loadConfig as ReturnType<typeof vi.fn>

// ── Helpers ────────────────────────────────────────────────────────────────

function mockElectronAPI(overrides: Partial<typeof window.electronAPI> = {}) {
  const api = {
    configGet:  vi.fn(),
    appVersion: vi.fn(),
    cacheRead:  vi.fn().mockResolvedValue(null),   // no disk cache by default
    cacheWrite: vi.fn().mockResolvedValue(undefined),
    onControl:  vi.fn(),
    offControl: vi.fn(),
    ...overrides,
  } satisfies typeof window.electronAPI;
  // @ts-ignore — node test environment has no window
  globalThis.window = { electronAPI: api }
  return api
}

function okResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (k: string) => headers[k] ?? null },
    json: () => Promise.resolve(data),
    blob: () => Promise.resolve(new Blob()),
  } as unknown as Response
}

function statusResponse(status: number, statusText = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: { get: () => null },
    json: () => Promise.reject(new Error('no body')),
  } as unknown as Response
}

function defaultConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    deviceId:                 'dev-1',
    token:                    'tok',
    apiUrl:                   'http://api',
    disableCache:             false,
    disablePrefetch:          false,
    cacheTtlMs:               60_000,
    appsettingsLookaheadDays: 3,
    controlEnabled:           false,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Api.get — caching and offline fallback', () => {
  let eapi: ReturnType<typeof mockElectronAPI>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    eapi = mockElectronAPI()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mockLoadConfig.mockResolvedValue(defaultConfig())
  })

  // ── 1. Happy path ─────────────────────────────────────────────────────

  it('fetches from network on cache miss and stores result in memory', async () => {
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValueOnce(okResponse({ id: 1 }))

    const result = await api.get<{ id: number }>('/items')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ id: 1 })
  })

  it('returns cached data without a network request when TTL has not expired', async () => {
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValue(okResponse({ id: 1 }))

    // First call populates the memory cache
    await api.get('/items')
    // Second call should hit the cache
    await api.get('/items')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after TTL expires', async () => {
    vi.useFakeTimers()
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValue(okResponse({ v: 1 }))
    mockLoadConfig.mockResolvedValue(defaultConfig({ cacheTtlMs: 1_000 }))

    await api.get('/items')                        // populates cache (t=0)
    vi.advanceTimersByTime(1_001)                  // TTL expired
    await api.get('/items')                        // should re-fetch

    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  // ── 2. ETag / 304 ─────────────────────────────────────────────────────

  it('returns cached data and skips JSON parsing on 304 Not Modified', async () => {
    vi.useFakeTimers()
    const api = new Api('http://localhost')

    // Seed cache with an ETag
    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }, { ETag: '"abc"' }))
    await api.get('/items')

    // Advance past default TTL so cache is considered stale
    vi.advanceTimersByTime(61_000)

    // Server replies 304
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 304, statusText: 'Not Modified',
      headers: { get: () => null },
    } as unknown as Response)
    const result = await api.get<{ v: number }>('/items')

    expect(result).toEqual({ v: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('"abc"')
    vi.useRealTimers()
  })

  // ── 3. Offline / stale fallback ───────────────────────────────────────

  it('returns stale cache when the network request throws (offline fallback)', async () => {
    const api = new Api('http://localhost')

    // First request succeeds → populates cache
    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))
    await api.get('/items')

    // Second request: network down
    fetchMock.mockRejectedValueOnce(new Error('Network error on GET http://localhost/items: Failed to fetch'))
    const result = await api.get<{ v: number }>('/items', { ttl: 0 })

    expect(result).toEqual({ v: 1 })
  })

  it('returns stale cache on 5xx server error', async () => {
    const api = new Api('http://localhost')

    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))
    await api.get('/items')

    fetchMock.mockResolvedValueOnce(statusResponse(503, 'Service Unavailable'))
    const result = await api.get<{ v: number }>('/items', { ttl: 0 })

    expect(result).toEqual({ v: 1 })
  })

  it('throws on 4xx — no stale fallback', async () => {
    vi.useFakeTimers()
    const api = new Api('http://localhost')

    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))
    await api.get('/items')

    vi.advanceTimersByTime(61_000) // expire the cache

    fetchMock.mockResolvedValueOnce(statusResponse(404, 'Not Found'))
    await expect(api.get('/items')).rejects.toThrow('404')
    vi.useRealTimers()
  })

  it('throws on 5xx when disableCache is true — no stale fallback', async () => {
    vi.useFakeTimers()
    mockLoadConfig.mockResolvedValue(defaultConfig({ disableCache: true }))
    const api = new Api('http://localhost')

    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))
    await api.get('/items')

    vi.advanceTimersByTime(61_000)

    fetchMock.mockResolvedValueOnce(statusResponse(503, 'Service Unavailable'))
    await expect(api.get('/items')).rejects.toThrow('503')
    vi.useRealTimers()
  })

  it('throws on network error when there is no cached data', async () => {
    const api = new Api('http://localhost')
    fetchMock.mockRejectedValueOnce(new Error('Failed to fetch'))

    await expect(api.get('/items')).rejects.toThrow()
  })

  // ── 4. disableCache flag ──────────────────────────────────────────────

  it('always fetches from network when disableCache is true', async () => {
    mockLoadConfig.mockResolvedValue(defaultConfig({ disableCache: true }))
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValue(okResponse({ v: 1 }))

    await api.get('/items')
    await api.get('/items')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not return stale cache on network error when disableCache is true', async () => {
    mockLoadConfig.mockResolvedValue(defaultConfig({ disableCache: true }))
    const api = new Api('http://localhost')

    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))
    await api.get('/items')

    fetchMock.mockRejectedValueOnce(new Error('Failed to fetch'))
    await expect(api.get('/items')).rejects.toThrow()
  })

  // ── 5. Disk cache (Electron IPC) ──────────────────────────────────────

  it('loads disk cache on construction and serves it before first network call', async () => {
    const diskCache = JSON.stringify({
      '/items': { data: { v: 42 }, cachedAt: Date.now(), etag: undefined },
    })
    eapi = mockElectronAPI({ cacheRead: vi.fn().mockResolvedValue(diskCache) })

    const api = new Api('http://localhost')
    await api.get('/items') // cacheReady is awaited inside get()

    // Should be served from disk cache — no network request needed
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not write blob to disk when disableCache is true', async () => {
    mockLoadConfig.mockResolvedValue(defaultConfig({ disableCache: true }))
    eapi = mockElectronAPI()
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValueOnce(okResponse({}))

    // Minimal blob response
    const blobFetch = {
      ok: true, status: 200,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob(['data'], { type: 'image/png' })),
    } as unknown as Response
    fetchMock.mockResolvedValueOnce(blobFetch)

    await api.getBlob('/image.png')

    expect(eapi.cacheWrite).not.toHaveBeenCalled()
  })

  it('persists response to disk after a successful fetch', async () => {
    vi.useFakeTimers()
    const api = new Api('http://localhost')
    fetchMock.mockResolvedValueOnce(okResponse({ v: 1 }))

    await api.get('/items')
    vi.advanceTimersByTime(2_500) // flush debounced saveCache (2 s)

    expect(eapi.cacheWrite).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
