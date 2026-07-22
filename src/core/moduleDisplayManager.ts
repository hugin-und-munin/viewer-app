import type { ModuleProps } from '../types/modules'
import { moduleRegistry, type ModuleName } from './moduleRegistry'
import { logEvent } from '../logging/deviceLogger'

// Maps each ModuleName to its component's props, e.g. Time → TimeProps
type ModulePropsMap = {
  [K in ModuleName]: React.ComponentProps<(typeof moduleRegistry)[K]>
}

type ModuleComponent<P = ModuleProps> = (props: P) => React.ReactNode

export interface Module<K extends ModuleName = ModuleName> {
  // Unique per showModule() call (not just per type) so React always mounts
  // a fresh component instance — see ModuleRenderer's key. Without this, two
  // consecutive loads of the same module type reuse the old instance instead
  // of restarting it (index/TTS/refs carry over instead of resetting).
  instanceId: number
  component: ModuleComponent<ModulePropsMap[K]>
  props: ModulePropsMap[K]
}

let nextInstanceId = 0
const listeners: ((module: Module | null) => void)[] = []
let displayedModule: Module | null = null

export function onModuleChange(callback: (module: Module | null) => void): void {
  listeners.push(callback)
}

export function offModuleChange(callback: (module: Module | null) => void): void {
  const index = listeners.indexOf(callback)
  if (index !== -1) listeners.splice(index, 1)
}

export function showModule(props: ModuleProps): void {
  const type = props.type as ModuleName
  const component = moduleRegistry[type]

  if (!component) {
    logEvent({ level: 'error', source: 'module', moduleType: type, message: 'unknown module type' })
    return
  }

  displayedModule = { instanceId: ++nextInstanceId, component, props } as Module<typeof type>
  listeners.forEach((fn) => fn(displayedModule))
  logEvent({ level: 'info', source: 'module', moduleType: type, message: 'module loaded' })
}

export function clearModule(): void {
  displayedModule = null
  listeners.forEach((fn) => fn(null))
}
