import { Link, NavLink, Outlet } from 'react-router-dom';
import { Wordmark } from './Logo';

const navLink =
  'text-sm text-muted transition hover:text-slate-100';
const navLinkActive = 'text-slate-100';

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-ink-900/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" aria-label="Verify My Interview home">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-7">
            <NavLink
              to="/how-it-works"
              className={({ isActive }) => `${navLink} ${isActive ? navLinkActive : ''}`}
            >
              How it works
            </NavLink>
            <NavLink
              to="/new"
              className={({ isActive }) => `${navLink} ${isActive ? navLinkActive : ''}`}
            >
              New case
            </NavLink>
            <NavLink
              to="/network"
              className={({ isActive }) => `${navLink} ${isActive ? navLinkActive : ''}`}
            >
              Network
            </NavLink>
            <Link to="/new" className="btn-primary text-sm">
              Run a check
            </Link>
          </nav>
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
