import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { History, SquarePen } from 'lucide-react';
import { Wordmark } from './Logo';
import { useCase } from '../store/caseStore';
import { AccountMenu } from './AccountMenu';

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
    <div className="min-h-screen bg-ink-900 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink-900/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <NavLink
            to="/"
            aria-label="Verify My Interview workspace"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Wordmark className="[&>span:last-child]:hidden sm:[&>span:last-child]:block" />
          </NavLink>

          <nav aria-label="Primary" className="flex items-center gap-1">
            <button type="button" onClick={startNewCheck} className={itemClass(newCheckActive)}>
              <SquarePen className="h-3.5 w-3.5" strokeWidth={1.75} />
              New check
            </button>
            <NavLink to="/history" className={({ isActive }) => itemClass(isActive)}>
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
    </div>
  );
}
