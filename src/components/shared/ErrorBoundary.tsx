import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
  name?: string;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const name = this.props.name ?? "unknown";
    console.error(`[kosmos:error-boundary:${name}]`, error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
          <p className="text-xs text-[var(--color-status-red)]">Something went wrong</p>
          <p className="text-xs text-[var(--color-text-muted)] max-w-md text-center break-all">
            {this.state.error.message}
          </p>
          <button
            className="text-xs px-3 py-1 bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border-primary)]"
            onClick={this.reset}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
