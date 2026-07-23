import type { ModuleProps } from '../types/modules'
import type { SchedulerEvent } from '../types/scheduler'
import { scheduleAtInterval as scheduleAtIntervalDefault } from '../utils/intervalScheduler'
import {
  showModule as showModuleDefault,
  clearModule as clearModuleDefault,
} from './moduleDisplayManager'
import { logEvent as logEventDefault } from '../logging/deviceLogger'
import { EventQueue } from './eventQueue'

type State = 'IDLE' | 'SHOWING' | 'SHUTTING_DOWN'

// A module that never calls onModuleDone after a shutdown request (e.g. a TTS
// "onEnd" that never fires) would otherwise wedge the scheduler in
// SHUTTING_DOWN forever — nothing else would ever show again.
const SHUTDOWN_TIMEOUT_MS = 2 * 60 * 1000

type Deps = {
  showModule: (props: ModuleProps) => void
  clearModule: () => void
  scheduleAtInterval: (minutes: 15 | 30 | 60, cb: () => void) => () => void
  logEvent: typeof logEventDefault
}

export default class ModuleScheduler {
  private state: State = 'IDLE'
  private stopped = false

  private rotatingModules: ModuleProps[] = []
  private moduleIndex = 0

  private intervalModules: ModuleProps[] = []
  private intervalStops: Array<() => void> = []

  private durationTimer?: ReturnType<typeof setTimeout>
  private shutdownWatchdog?: ReturnType<typeof setTimeout>
  private currentModuleType?: string

  private queue = new EventQueue()
  private shutdownTrigger?: () => void

  private deps: Deps

  constructor(modules: ModuleProps[], deps?: Partial<Deps>) {
    this.deps = {
      showModule: showModuleDefault,
      clearModule: clearModuleDefault,
      scheduleAtInterval: scheduleAtIntervalDefault,
      logEvent: logEventDefault,
      ...deps,
    }
    this.initModules(modules)
  }

  public start(): void {
    this.startIntervalSchedules()
    this.advance()
  }

  public forceStop(): void {
    this.stopped = true
    this.stopIntervalSchedules()
    this.clearDurationTimer()
    this.clearShutdownWatchdog()
    this.queue.clear()
    this.state = 'IDLE'
  }

  public updateConfig(modules: ModuleProps[]): void {
    this.handleEvent({ type: 'ConfigChanged', modules })
  }

  private initModules(modules: ModuleProps[]): void {
    this.intervalModules = modules.filter((m) => m.interval != null)
    this.rotatingModules = modules.filter((m) => m.interval == null)
    console.log(
      '[ModuleScheduler] initModules — rotating:',
      this.rotatingModules.map((m) => m.type),
      'interval:',
      this.intervalModules.map((m) => m.type),
    )
  }

  private startIntervalSchedules(): void {
    for (const m of this.intervalModules) {
      const stop = this.deps.scheduleAtInterval(m.interval!, () => {
        this.handleEvent({ type: 'IntervalDue', module: m })
      })
      this.intervalStops.push(stop)
    }
  }

  private stopIntervalSchedules(): void {
    for (const stop of this.intervalStops) stop()
    this.intervalStops = []
  }

  private handleEvent(event: SchedulerEvent): void {
    if (this.stopped) return
    console.log(`[ModuleScheduler] handleEvent: ${event.type} (state=${this.state})`)
    if (event.type === 'ConfigChanged') {
      this.stopIntervalSchedules()
      this.initModules(event.modules)
      this.moduleIndex = 0
      this.startIntervalSchedules()
    }

    this.queue.push(event)

    if (this.state === 'SHOWING') {
      this.beginShutdown()
    } else if (this.state === 'IDLE') {
      this.advance()
    }
    // SHUTTING_DOWN: event is queued, consumed once shutdown completes
  }

  private beginShutdown(): void {
    if (this.state !== 'SHOWING') return
    this.state = 'SHUTTING_DOWN'
    this.clearDurationTimer()

    if (this.shutdownTrigger) {
      // Captured before calling the trigger: a module with nothing to wrap up
      // (e.g. no TTS/audio playing) may call onModuleDone synchronously from
      // within the trigger, which advances to and runs the *next* module
      // before this line would otherwise read it.
      const moduleType = this.currentModuleType
      this.shutdownTrigger() // signal module to wrap up; it will call onModuleDone when done

      // If that already completed the shutdown synchronously (state moved
      // past SHUTTING_DOWN), there's nothing left to watch — arming a
      // watchdog here would incorrectly fire against whatever module is
      // running now, which never asked to be interrupted.
      if (this.state !== 'SHUTTING_DOWN') return

      this.shutdownWatchdog = setTimeout(() => {
        console.warn(`[ModuleScheduler] ${moduleType} did not respond to shutdown within ${SHUTDOWN_TIMEOUT_MS}ms — forcing interrupt`)
        this.deps.logEvent({
          level: 'error',
          source: 'module',
          moduleType,
          message: `module did not respond to shutdown within ${SHUTDOWN_TIMEOUT_MS / 1000}s — forced interrupt`,
        })
        this.handleModuleDone()
      }, SHUTDOWN_TIMEOUT_MS)
    } else {
      this.handleModuleDone() // no cleanup registered — advance immediately
    }
  }

  private handleModuleDone(): void {
    if (this.stopped || this.state === 'IDLE') return
    this.clearDurationTimer()
    this.clearShutdownWatchdog()
    console.log('[ModuleScheduler] handleModuleDone — transitioning to IDLE')
    this.state = 'IDLE'

    this.advance()
  }

  private advance(): void {
    const event = this.queue.getHighest()

    if (event?.type === 'ConfigChanged') {
      this.queue.clear() // all queued events are stale after a config change
    } else if (event) {
      this.queue.remove(event) // consume only this event, others stay
    }

    const next = this.resolveNext(event)
    if (next) {
      this.run(next)
    } else {
      console.log('[ModuleScheduler] advance — nothing to show, going idle')
      this.deps.clearModule()
    }
  }

  private resolveNext(event: SchedulerEvent | undefined): ModuleProps | undefined {
    if (event?.type === 'IntervalDue') {
      return event.module
    }

    if (this.rotatingModules.length === 0) return undefined

    const next = this.rotatingModules[this.moduleIndex % this.rotatingModules.length]
    this.moduleIndex++
    return next
  }

  private run(module: ModuleProps): void {
    console.log('[ModuleScheduler] showing module', module)
    this.state = 'SHOWING'
    this.shutdownTrigger = undefined
    this.currentModuleType = module.type

    this.deps.showModule({
      ...module,
      onShutdownRequest: (trigger) => {
        this.shutdownTrigger = trigger
      },
      onModuleDone: () => {
        this.handleModuleDone()
      },
    })

    if (module.duration != null) {
      this.durationTimer = setTimeout(() => {
        this.durationTimer = undefined
        this.handleEvent({ type: 'DurationExpired' })
      }, module.duration)
    }
  }

  private clearDurationTimer(): void {
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = undefined
    }
  }

  private clearShutdownWatchdog(): void {
    if (this.shutdownWatchdog) {
      clearTimeout(this.shutdownWatchdog)
      this.shutdownWatchdog = undefined
    }
  }
}
