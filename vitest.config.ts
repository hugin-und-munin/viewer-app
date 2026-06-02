import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts — no Electron plugin, no envDir needed.
export default defineConfig({
  test: {
    environment: 'node',
  },
})
