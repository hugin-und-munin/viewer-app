import type { ModuleProps } from '../types/modules'
import { moduleRegistry, type ModuleName } from './moduleRegistry'

// Maps each ModuleName to its component's props, e.g. Time → TimeProps
type ModulePropsMap = {
  [K in ModuleName]: React.ComponentProps<(typeof moduleRegistry)[K]>
}

type ModuleComponent<P = ModuleProps> = (props: P) => React.ReactNode

export interface Module<K extends ModuleName = ModuleName> {
  component: ModuleComponent<ModulePropsMap[K]>
  props: ModulePropsMap[K]
}

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

  displayedModule = { component, props } as Module<typeof type>
  listeners.forEach((fn) => fn(displayedModule))
}

export function clearModule(): void {
  displayedModule = null
  listeners.forEach((fn) => fn(null))
}
