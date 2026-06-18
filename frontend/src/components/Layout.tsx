import { NavLink, Outlet } from 'react-router-dom';
import { History, SquarePen } from 'lucide-react';
import { Wordmark } from './Logo';

const navItems = [
  { to: '/', label: 'New check', icon: SquarePen, end: true },
  { to: '/history', label: 'History', icon: History, end: false },
];

export function Layout() {
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
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:text-sm ${
                      isActive ? 'bg-ink-800 text-white' : 'text-muted hover:bg-ink-850 hover:text-slate-200'
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
