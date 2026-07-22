import { useEffect } from 'react'
import { ConfigService } from '../core/configService'
import { ControlService } from '../core/controlService'
import type { PauseCommand, LoadModuleCommand } from '../core/controlService'
import ModuleScheduler from '../core/moduleScheduler'
import { clearModule, showModule } from '../core/moduleDisplayManager'
import { prefetchAll } from '../core/cachePrefetcher'
import { loadConfig } from '../api/deviceConfig'
import type { ModuleProps } from '../types/modules'

function BackgroundController() {
  useEffect(() => {
    const configService = new ConfigService()
    const controlService = new ControlService()
    let scheduler: ModuleScheduler | null = null
    let overrideTimer: ReturnType<typeof setTimeout> | null = null

    const stopScheduler = () => {
      scheduler?.forceStop()
      scheduler = null
    }

    const endOverride = () => {
      if (overrideTimer) {
        clearTimeout(overrideTimer)
        overrideTimer = null
      }
      clearModule()
      configService.start() // fetches fresh config immediately, resumes normal scheduling
    }

    const onConfigChanged = (modules: ModuleProps[]) => {
      if (modules.length === 0) {
        stopScheduler()
        clearModule()
        return
      }
      if (!scheduler) {
        scheduler = new ModuleScheduler(modules)
        scheduler.start()
      } else {
        scheduler.updateConfig(modules)
      }
    }

    const onPause = ({ duration }: PauseCommand) => {
      configService.stop()
      stopScheduler()
      clearModule()
      if (overrideTimer) clearTimeout(overrideTimer)
      overrideTimer = setTimeout(endOverride, duration * 60 * 1000)
    }

    const onLoadModule = (module: LoadModuleCommand) => {
      configService.stop()
      stopScheduler()
      if (overrideTimer) clearTimeout(overrideTimer)
      showModule({
        ...module,
        onModuleDone: endOverride,
      })
      overrideTimer = setTimeout(endOverride, module.duration)
    }

    // controlEnabled is read async from runtime config. `cancelled` guards
    // against the effect having already been cleaned up by the time this
    // resolves (React StrictMode runs mount→cleanup→mount once in dev,
    // and the cleanup can fire before this promise settles) — without it,
    // a stale instance could start listening after teardown and never get
    // stopped, leaving two ControlServices registered and every command
    // handled (and logged) twice.
    let cancelled = false

    configService.on('configChanged', onConfigChanged)
    configService.start()

    prefetchAll().catch(() => {})
    const prefetchIntervalId = setInterval(() => prefetchAll().catch(() => {}), 1 * 60 * 60 * 1000)

    loadConfig().then(({ controlEnabled }) => {
      if (cancelled || !controlEnabled) return
      controlService.on('pause', onPause)
      controlService.on('loadModule', onLoadModule)
      controlService.start()
    })

    return () => {
      cancelled = true
      clearInterval(prefetchIntervalId)
      if (overrideTimer) clearTimeout(overrideTimer)
      stopScheduler()
      configService.stop()
      controlService.stop() // safe no-op if start() was never called
      configService.off('configChanged', onConfigChanged)
      controlService.off('pause', onPause)
      controlService.off('loadModule', onLoadModule)
    }
  }, [])

  return null
}

export default BackgroundController
