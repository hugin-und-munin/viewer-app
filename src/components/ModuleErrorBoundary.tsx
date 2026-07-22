import { Component, type ReactNode } from 'react'
import { logEvent } from '../logging/deviceLogger'

interface Props {
  moduleType: string
  children: ReactNode
}

interface State {
  hasError: boolean
}

// Catches render errors thrown by module components so a single broken
// module can't take down the whole display — reports the failure and
// falls back to rendering nothing until the next module rotation.
// The parent remounts this component (via a `key` on moduleType) on every
// module switch, so `hasError` naturally resets — no manual reset needed.
class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    logEvent({
      level: 'error',
      source: 'module',
      moduleType: this.props.moduleType,
      message: error.message,
    })
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export default ModuleErrorBoundary
