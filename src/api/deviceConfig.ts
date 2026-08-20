let _config: AppConfig | null = null

export async function loadConfig(): Promise<AppConfig> {
  if (_config) return _config
  _config = await window.electronAPI!.configGet()
  return _config
}

const DEVICE_ID_CACHE_FILE = 'device-id.json'

// deviceId itself isn't secret (unlike the access token) and never changes
// for a given device, so it's safe and useful to persist on its own. That
// matters on a cold start with no network: getToken() has nothing to hand
// back yet (its cache is in-memory only), but everything downstream of
// loadDeviceConfig() only needs the id to build endpoint URLs — the actual
// data for those requests can still come from api.ts's own on-disk stale
// cache, *if* execution ever reaches those get() calls. Without a
// fallback here, it never does: this throws first and every caller below
// it never gets a chance to serve what's already cached.
export async function loadDeviceConfig(): Promise<{ deviceId: string }> {
  // Import here to avoid circular dependency (tokenManager → loadConfig → tokenManager)
  const { getTokenManager } = await import('./tokenManager')
  try {
    const { deviceId } = await getTokenManager().getToken()
    if (window.electronAPI) {
      window.electronAPI
        .cacheWrite(DEVICE_ID_CACHE_FILE, JSON.stringify({ deviceId }))
        .catch(() => {})
    }
    return { deviceId }
  } catch (err) {
    if (window.electronAPI) {
      const raw = await window.electronAPI.cacheRead(DEVICE_ID_CACHE_FILE).catch(() => null)
      try {
        const cached = raw ? (JSON.parse(raw) as { deviceId?: string }) : null
        if (cached?.deviceId) return { deviceId: cached.deviceId }
      } catch {
        // corrupt cache file — fall through to the original error
      }
    }
    throw err
  }
}
