import { EventEmitter } from 'events'
import type { ModuleProps } from '../types/modules'

export interface PauseCommand {
  duration: number // minutes
}

export type LoadModuleCommand = ModuleProps

type ControlMessage =
  | { command: 'pause'; duration: number }
  | ({ command: 'loadModule' } & ModuleProps)

export class ControlService extends EventEmitter {
  private listener: ((data: unknown) => void) | null = null

  start(): void {
    if (!window.electronAPI) {
      console.warn('[ControlService] electronAPI not available — control commands disabled')
      return
    }
    this.listener = (data) => this.handleMessage(data)
    window.electronAPI.onControl(this.listener)
    console.log('[ControlService] listening via Electron IPC')
  }

  stop(): void {
    if (this.listener && window.electronAPI) {
      window.electronAPI.offControl(this.listener)
      this.listener = null
    }
    console.log('[ControlService] stopped')
  }

  private handleMessage(data: unknown): void {
    console.log('[ControlService] message received:', data)
    if (!data || typeof data !== 'object') {
      console.warn('[ControlService] ignored — not an object:', data)
      return
    }
    const msg = data as ControlMessage

    if (msg.command === 'pause' && typeof msg.duration === 'number') {
      console.log('[ControlService] emitting pause:', msg.duration, 'min')
      this.emit('pause', { duration: msg.duration } satisfies PauseCommand)
    } else if (msg.command === 'loadModule') {
      const { command: _command, ...rest } = msg
      console.log('[ControlService] emitting loadModule:', rest)
      this.emit('loadModule', rest as LoadModuleCommand)
    } else {
      console.warn('[ControlService] unknown command:', (msg as Record<string, unknown>).command)
    }
  }
}
