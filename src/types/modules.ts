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

export type ModuleProps = ChatProps | RoutineProps | TimeProps
