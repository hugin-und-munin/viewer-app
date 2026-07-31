import Chat from '../components/modules/Chat'
import Routine from '../components/modules/Routine'
import Time from '../components/modules/Time'
import Weather from '../components/modules/Weather'

export const moduleRegistry = {
  Chat,
  Time,
  Routine,
  Weather,
} as const

type RegistryKey = keyof typeof moduleRegistry

// Enum-like access: ModuleName.Time === "Time"
export const ModuleName = (Object.keys(moduleRegistry) as RegistryKey[]).reduce(
  (acc, key) => ({ ...acc, [key]: key }),
  {} as { [K in RegistryKey]: K },
)

export type ModuleName = RegistryKey
