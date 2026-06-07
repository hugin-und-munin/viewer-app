import type { ModuleProps } from './modules'

export type SchedulerEvent =
  | { type: 'ConfigChanged'; modules: ModuleProps[] }
  | { type: 'IntervalDue'; module: ModuleProps }
  | { type: 'DurationExpired' }

export const EVENT_PRIORITY: Record<SchedulerEvent['type'], number> = {
  ConfigChanged: 1,
  IntervalDue: 2,
  DurationExpired: 3,
}
