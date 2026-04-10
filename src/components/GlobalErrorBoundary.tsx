import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Sentry } from '../analytics/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  eventId: string | null;
}

// Global React error boundary — equivalent to Next.js app/global-error.tsx.
// Catches render errors anywhere in the tree, reports them to Sentry, and
// shows a user-friendly fallback instead of a blank screen.
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const eventId = Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
    this.setState({ eventId: eventId ?? null });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8] p-6">
          <div className="max-w-sm text-center">
            <h1 className="mb-2 text-lg font-semibold text-stone-800">Something went wrong</h1>
            <p className="mb-5 text-sm text-stone-500">
              BrowserBud encountered an unexpected error. The team has been notified.
            </p>
            {this.state.eventId && (
              <p className="mb-5 font-mono text-xs text-stone-400">
                Error ID: {this.state.eventId}
              </p>
            )}
            <button
              onClick={this.handleReload}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white transition-colors hover:bg-teal-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
