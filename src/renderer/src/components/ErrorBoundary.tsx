import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  panelName: string
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary that catches render errors in a single panel.
 * When an error is caught, only that panel shows a fallback UI;
 * the rest of the app continues to work.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console (will be routed through electron-log in the future)
    console.error(
      `[ErrorBoundary] Panel "${this.props.panelName}" crashed:`,
      error.message,
      '\nComponent stack:',
      info.componentStack,
    )
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center h-full bg-[var(--bg-primary)] text-[var(--text-primary)] gap-4 p-8">
          <h2 className="text-lg font-semibold text-[var(--error)]">
            {this.props.panelName} panel crashed
          </h2>
          <pre className="text-xs text-[var(--text-secondary)] bg-[var(--bg-card)] p-4 rounded-[var(--radius-md)] max-w-2xl overflow-auto whitespace-pre-wrap flux-scroll">
            {this.state.error?.message}
          </pre>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 text-sm bg-[var(--accent)] text-white rounded-[var(--radius-sm)] hover:bg-[var(--accent-hover)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
