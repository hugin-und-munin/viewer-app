/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_DISABLE_CACHE: string
  readonly VITE_CONTROL_ENABLED: string
  readonly VITE_DEVICE_ID?: string
  readonly VITE_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
