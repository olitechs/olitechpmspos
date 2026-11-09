import React from 'react';
import { AlertTriangle, Home, RefreshCw, Copy } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ errorInfo: info || null });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props.label || '', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null, errorInfo: null, copied: false });
  };

  getDiagnosticText() {
    const error = this.state.error;
    const info = this.state.errorInfo;
    return [
      `Section: ${this.props.label || 'This section'}`,
      `Route: ${typeof window !== 'undefined' ? window.location.pathname : 'unknown'}`,
      `Error: ${error?.name || 'Error'}: ${error?.message || 'An unexpected application error occurred.'}`,
      error?.stack ? `JavaScript stack:\n${error.stack}` : '',
      info?.componentStack ? `React component stack:\n${info.componentStack}` : '',
    ].filter(Boolean).join('\n\n');
  }

  copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(this.getDiagnosticText());
      this.setState({ copied: true });
    } catch {
      this.setState({ copied: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const label = this.props.label || 'This section';
    const error = this.state.error;
    const message = error?.message || 'An unexpected application error occurred.';
    const diagnostics = this.getDiagnosticText();

    return (
      <div className="m-4 flex min-h-40 items-center justify-center rounded-2xl border border-[var(--danger)] bg-[var(--danger-soft)] p-6 text-[var(--danger-text)]">
        <div className="w-full max-w-xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-[var(--danger-soft)] p-2 text-[var(--danger-text)]">
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{label} isn't available right now.</div>
              <div className="mt-1 text-xs leading-5 text-[var(--danger-text)]">
                The rest of the system is unaffected. You can retry this section or return to the dashboard.
              </div>
              <details className="mt-3 rounded-xl border border-[var(--danger)] bg-surface/70 p-3 text-xs">
                <summary className="cursor-pointer font-semibold">Technical details</summary>
                <div className="mt-2 space-y-2">
                  <div className="font-semibold">{error?.name || 'Error'}: {message}</div>
                  {error?.stack && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{error.stack}</pre>}
                  {this.state.errorInfo?.componentStack && (
                    <>
                      <div className="font-semibold">React component stack</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{this.state.errorInfo.componentStack}</pre>
                    </>
                  )}
                  <button type="button" onClick={this.copyDiagnostics} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-surface px-3 py-2 font-semibold">
                    <Copy size={13} aria-hidden="true" /> {this.state.copied ? 'Diagnostics copied' : 'Copy diagnostics'}
                  </button>
                </div>
              </details>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={this.reset} className="inline-flex items-center gap-2 rounded-lg bg-[var(--danger)] px-3 py-2 text-xs font-semibold text-[var(--danger-foreground)] hover:opacity-90">
                  <RefreshCw size={14} aria-hidden="true" /> Try again
                </button>
                <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-surface px-3 py-2 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">
                  <RefreshCw size={14} aria-hidden="true" /> Reload app
                </button>
                <a href="/" className="inline-flex items-center gap-2 rounded-lg border border-[var(--danger)] bg-surface px-3 py-2 text-xs font-semibold text-[var(--danger-text)] hover:bg-[var(--danger-soft)]">
                  <Home size={14} aria-hidden="true" /> Dashboard
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
