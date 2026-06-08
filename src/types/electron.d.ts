declare global {
  interface AppConfig {
    clientId: string
    clientSecret: string
    apiUrl: string
    disableCache: boolean
    disablePrefetch: boolean
    cacheTtlMs: number
    appsettingsLookaheadDays: number
    controlEnabled: boolean
  }

  interface ElectronAPI {
    configGet: () => Promise<AppConfig>
    appVersion: () => Promise<string>
    cacheRead: (filename: string) => Promise<string | null>
    cacheWrite: (filename: string, data: string) => Promise<void>
    onControl: (callback: (data: unknown) => void) => void
    offControl: (callback: (data: unknown) => void) => void
  }

  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
