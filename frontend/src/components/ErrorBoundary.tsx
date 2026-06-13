// Last-resort render guard: a component crash shows a calm recovery card
// instead of a white screen. State is intentionally minimal — recovery is a
// full reload, which also resets the case store.

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-[60vh] place-items-center px-6">
        <div role="alert" className="surface max-w-md p-6 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-risk-needs" strokeWidth={1.75} />
          <p className="mt-3 text-sm font-medium text-slate-100">Something went wrong.</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            We could not keep this page open safely. Your evidence is not stored. Start a fresh
            check when you are ready.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="btn-primary mt-4 w-full"
          >
            Start fresh
          </button>
        </div>
      </div>
    );
  }
}
