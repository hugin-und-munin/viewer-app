import { loadConfig } from './deviceConfig'

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  device_id: string
}

interface CachedToken {
  accessToken: string
  deviceId: string
  expiresAt: number
}

class TokenManager {
  private cached: CachedToken | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<CachedToken> | null = null

  async getToken(): Promise<{ accessToken: string; deviceId: string }> {
    if (this.cached && Date.now() < this.cached.expiresAt) {
      return this.cached
    }
    return this.fetchToken()
  }

  invalidate(): void {
    this.cached = null
    clearTimeout(this.refreshTimer)
  }

  private async fetchToken(): Promise<CachedToken> {
    if (this.inflight) return this.inflight

    this.inflight = (async () => {
      const { clientId, clientSecret, apiUrl } = await loadConfig()
      const res = await fetch(`${apiUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      })

      if (!res.ok) {
        let detail = ''
        try {
          const err = await res.json()
          detail = err.error_description ?? err.error ?? ''
        } catch {}
        throw new Error(`[auth] token fetch failed (${res.status}): ${detail}`)
      }

      const data: TokenResponse = await res.json()
      console.log('[auth] token acquired, device_id:', data.device_id)

      const token: CachedToken = {
        accessToken: data.access_token,
        deviceId: data.device_id,
        expiresAt: Date.now() + data.expires_in * 1000,
      }

      this.cached = token
      this.scheduleRefresh(data.expires_in)
      return token
    })().finally(() => {
      this.inflight = null
    })

    return this.inflight
  }

  private scheduleRefresh(expiresIn: number): void {
    clearTimeout(this.refreshTimer)
    const delay = Math.max(0, (expiresIn - 60) * 1000)
    this.refreshTimer = setTimeout(() => {
      this.cached = null
      this.fetchToken().catch((err) => console.error('[auth] proactive refresh failed:', err))
    }, delay)
  }
}

let _manager: TokenManager | null = null

export function getTokenManager(): TokenManager {
  if (!_manager) _manager = new TokenManager()
  return _manager
}
