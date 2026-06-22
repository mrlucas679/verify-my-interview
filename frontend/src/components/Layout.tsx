import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { History, SquarePen } from 'lucide-react';
import { Wordmark } from './Logo';
import { useCase } from '../store/caseStore';
import { AccountMenu } from './AccountMenu';
import { HistoryRail } from './HistoryRail';

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { newCase } = useCase();
  const newCheckActive = location.pathname === '/';

  function startNewCheck() {
    if (location.pathname === '/') {
      window.dispatchEvent(new Event('vmi:new-check'));
    } else {
      newCase();
    }
    navigate('/');
  }

  const itemClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:text-sm ${
      active ? 'bg-ink-800 text-white' : 'text-muted hover:bg-ink-850 hover:text-slate-200'
    }`;

  return (
    <div className="min-h-screen bg-ink-900 text-slate-100 lg:flex">
      <aside className="hidden h-screen w-72 shrink-0 flex-col border-r border-line/70 bg-ink-950/70 lg:sticky lg:top-0 lg:flex">
        <div className="px-4 py-4">
          <NavLink
            to="/"
            aria-label="Verify My Interview workspace"
            className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Wordmark />
          </NavLink>
        </div>
        <HistoryRail />
        <div className="flex items-center gap-3 border-t border-line/60 px-4 py-3 text-xs text-faint">
          <NavLink to="/privacy" className="transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Privacy
          </NavLink>
          <NavLink to="/terms" className="transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            Terms
          </NavLink>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-line/70 bg-ink-900/90 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
            <NavLink
              to="/"
              aria-label="Verify My Interview workspace"
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:hidden"
            >
              <Wordmark className="[&>span:last-child]:hidden sm:[&>span:last-child]:block" />
            </NavLink>

            <p className="hidden text-sm text-muted lg:block">Investigation workspace</p>

            <nav aria-label="Primary" className="flex items-center gap-1">
              <button type="button" onClick={startNewCheck} className={`${itemClass(newCheckActive)} lg:hidden`}>
                <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} />
                New check
              </button>
              <NavLink to="/history" className={({ isActive }) => `${itemClass(isActive)} lg:hidden`}>
                <History className="h-3.5 w-3.5" strokeWidth={1.75} />
                History
              </NavLink>
              <AccountMenu />
            </nav>
          </div>
        </header>

        <main>
          <Outlet />
        </main>
        <footer className="border-t border-line/60 bg-ink-900 px-4 py-4 text-center text-xs text-faint lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <NavLink to="/privacy" className="transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              Privacy
            </NavLink>
            <NavLink to="/terms" className="transition hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              Terms
            </NavLink>
          </div>
        </footer>
      </div>
    </div>
  );
}
