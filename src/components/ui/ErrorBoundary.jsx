import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const label = this.props.label || 'This section';
    const message = this.state.error?.message || 'An unexpected application error occurred.';

    return (
      <div className="m-4 flex min-h-40 items-center justify-center rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
        <div className="w-full max-w-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-red-100 p-2 text-red-700">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{label} isn't available right now.</div>
              <div className="mt-1 text-xs leading-5 text-red-800/80">
                The rest of the system is unaffected. You can retry this section or return to the dashboard.
              </div>
              <details className="mt-3 rounded-xl border border-red-200 bg-white/70 p-3 text-xs">
                <summary className="cursor-pointer font-semibold">Technical details</summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{message}</pre>
              </details>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={this.reset} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800">
                  <RefreshCw size={14} aria-hidden="true" />
                  Try again
                </button>
                <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-900 hover:bg-red-50">
                  <RefreshCw size={14} aria-hidden="true" />
                  Reload app
                </button>
                <Link to="/" className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-900 hover:bg-red-50">
                  <Home size={14} aria-hidden="true" />
                  Dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
