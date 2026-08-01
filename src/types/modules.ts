export interface BaseModule {
  type: string
  module_id: string
  duration: number
  interval?: 15 | 30 | 60
  transitionSound?: boolean
  onShutdownRequest?: (trigger: () => void) => void
  onModuleDone?: () => void
}

export interface ChatProps extends BaseModule {
  type: 'Chat'
  audio: boolean
  voice?: 'male' | 'female'
  fontSize?: 'small' | 'medium' | 'large'
  readingSpeed?: 'slow' | 'normal' | 'fast'
  pause?: 'short' | 'medium' | 'long'
  repeat?: boolean
  theme?: 'light' | 'dark'
  recentMessageCount?: number
  imageDuration?: number
}

export interface RoutineProps extends BaseModule {
  type: 'Routine'
  audio: boolean
  voice?: 'male' | 'female'
  readingSpeed?: 'slow' | 'normal' | 'fast'
  pause?: 'short' | 'medium' | 'long'
  repeat?: boolean
  mode?: 'overview' | 'simple'
  theme?: 'light' | 'dark'
}

export interface TimeProps extends BaseModule {
  type: 'Time'
  interval: 15 | 30 | 60
  clockType?: 'digital' | 'analog'
  format?: string
  showSeconds?: boolean
  showDate?: boolean
  audio?: boolean
  voice?: 'male' | 'female'
  readingSpeed?: 'slow' | 'normal' | 'fast'
  pause?: 'short' | 'medium' | 'long'
  repeat?: boolean
  timeAnnouncement?: 'natural' | 'exact'
  theme?: 'light' | 'dark'
}

export interface WeatherProps extends BaseModule {
  type: 'Weather'
  latitude?: number
  longitude?: number
  imageSource?: 'icon' | 'photo'
  showTemperature?: boolean
  announceTomorrow?: boolean
  audio?: boolean
  voice?: 'male' | 'female'
  readingSpeed?: 'slow' | 'normal' | 'fast'
  pause?: 'short' | 'medium' | 'long'
  repeat?: boolean
  // No theme setting — the background colour itself is the day/night
  // signal, which a user-selectable dark mode would fight with.
  // Dev/QA only, not exposed in the settings schema: cycles through a fixed
  // list of synthetic time/temperature/weather states (see
  // weatherTestScenarios.ts) instead of fetching real data — a different
  // state each time the module is (re)loaded.
  testCycle?: boolean
}

export type ModuleProps = ChatProps | RoutineProps | TimeProps | WeatherProps
