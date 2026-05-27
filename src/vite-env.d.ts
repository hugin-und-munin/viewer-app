/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL:                    string
  readonly VITE_DISABLE_CACHE:              string
  readonly VITE_DISABLE_PREFETCH:           string
  readonly VITE_CACHE_TTL_MS:               string
  readonly VITE_APPSETTINGS_LOOKAHEAD_DAYS: string
  readonly VITE_CONTROL_ENABLED:            string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
