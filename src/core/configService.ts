import { EventEmitter } from 'events'
import type { ModuleProps } from '../types/modules'
import { getCurrentModules } from '../api/appconfig.api'
import { logEvent } from '../logging/deviceLogger'
import isEqual from 'lodash.isequal'

export class ConfigService extends EventEmitter {
  private modules: ModuleProps[] = []
  private intervalId: ReturnType<typeof setInterval> | undefined
  private pollInterval: number
  // Only re-logged when the message changes, so a persistent non-network
  // config problem (bad data, not connectivity) doesn't spam once per poll.
  private lastLoggedError: string | null = null

  constructor(pollInterval?: number) {
    super()
    this.pollInterval = pollInterval ?? 20000 // default to 20s
  }

  start() {
    this.fetchAndUpdate()
    this.intervalId = setInterval(() => this.fetchAndUpdate(), this.pollInterval)
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId)
    this.modules = []
  }

  private async fetchAndUpdate() {
    try {
      const modules = await getCurrentModules()
      this.lastLoggedError = null
      if (!isEqual(modules, this.modules)) {
        this.modules = modules
        this.emit('configChanged', modules)
      }
    } catch (err) {
      console.error('Failed to fetch config:', err)
      const message = err instanceof Error ? err.message : String(err)
      // Network-level failures already get their own transition log via
      // networkMonitor (src/api/api.ts) — skip to avoid logging it twice.
      if (message.startsWith('Network error on')) return
      if (message !== this.lastLoggedError) {
        this.lastLoggedError = message
        logEvent({ level: 'error', source: 'app', message: `config fetch failed: ${message}` })
      }
    }
  }
}
