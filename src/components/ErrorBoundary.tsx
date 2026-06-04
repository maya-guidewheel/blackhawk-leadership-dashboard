import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
  info: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: '' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.fallbackLabel ?? 'component', 'crashed:', error)
    console.error('[ErrorBoundary] component stack:', info.componentStack)
    this.setState({ info: info.componentStack?.slice(0, 400) ?? '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="rounded-xl border border-danger bg-danger/5 p-6 my-4">
        <div className="text-sm font-semibold text-danger mb-2">
          {this.props.fallbackLabel ?? 'This section'} encountered an error and could not render.
        </div>
        <div className="text-xs text-muted-foreground mb-3">
          The error has been logged to the browser console. Refreshing the page may help.
        </div>
        {this.state.error && (
          <pre className="text-xs text-danger bg-background rounded px-3 py-2 overflow-x-auto">
            {this.state.error.message}
          </pre>
        )}
        <button
          className="mt-3 text-xs text-btn-primary hover:underline"
          onClick={() => this.setState({ hasError: false, error: null, info: '' })}
        >
          Try again
        </button>
      </div>
    )
  }
}
