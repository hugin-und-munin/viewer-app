/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_DISABLE_CACHE: string
  readonly VITE_CONTROL_ENABLED: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
