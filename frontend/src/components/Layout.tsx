import { Link, Outlet, useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Wordmark } from './Logo';

export function Layout() {
  const { pathname } = useLocation();
  // The only nav action is "New check", and it only makes sense once the user
  // has left the intake page (i.e. on the report).
  const showNewCheck = pathname !== '/';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            to="/"
            aria-label="Verify My Interview — new check"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Wordmark />
          </Link>
          {showNewCheck && (
            <Link to="/" className="btn-ghost text-sm">
              <Plus className="h-4 w-4" strokeWidth={1.75} /> New check
            </Link>
          )}
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-line/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-7 text-xs text-faint sm:flex-row">
          <Wordmark className="opacity-70" />
          <p className="text-center">
            Synthetic demo for the Microsoft Agents League. Not financial or legal advice — always
            verify independently.
          </p>
        </div>
      </footer>
    </div>
  );
}
