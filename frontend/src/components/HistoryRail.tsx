import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Clock3, Flag, Loader2, MessageSquare, Search, SquarePen, Trash2 } from 'lucide-react';
import { useCase, type HistoryItem } from '../store/caseStore';
import type { RiskLevel } from '../lib/types';

const RISK_TEXT: Record<RiskLevel, string> = {
  'Low Risk': 'text-risk-low',
  'Needs More Verification': 'text-risk-needs',
  Suspicious: 'text-risk-suspicious',
  'Likely Scam': 'text-risk-scam',
  Inconclusive: 'text-risk-inconclusive',
};

interface HistoryRailProps {
  variant?: 'rail' | 'page';
}

interface HistoryGroup {
  label: string;
  items: HistoryItem[];
}

function cleanPreview(value: string, limit: number): string {
  const clean = value
    .replace(/^User message\s*/i, '')
    .replace(/\n+---\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).trim()}...`;
}

function itemPreview(item: HistoryItem, limit: number): string {
  const source = item.evidence || item.summary;
  const preview = cleanPreview(source, limit);
  return preview || (item.kind === 'report' ? 'Report received' : 'Saved investigation');
}

function itemMeta(item: HistoryItem): string {
  if (item.kind === 'report') return item.reportId ? `Report ${item.reportId}` : 'Report';
  if (item.riskLevel) {
    return typeof item.riskScore === 'number' ? `${item.riskLevel} - ${item.riskScore}/100` : item.riskLevel;
  }
  return item.source === 'server' ? 'Account case' : 'Check';
}

function groupLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startToday - startDate) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return 'Older';
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function groupHistory(items: HistoryItem[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const item of items.slice(0, 60)) {
    const label = groupLabel(item.createdAt);
    const existing = groups.find((group) => group.label === label);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

function EmptyState({ variant }: { variant: 'rail' | 'page' }) {
  const compact = variant === 'rail';
  return (
    <div className={compact ? 'px-2 py-6 text-sm text-faint' : 'py-12 text-center text-sm text-muted'}>
      <MessageSquare className={compact ? 'mb-3 h-4 w-4 text-faint' : 'mx-auto mb-3 h-5 w-5 text-faint'} strokeWidth={1.75} />
      <p>No history yet.</p>
      {!compact && (
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-accent transition hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <SquarePen className="h-4 w-4" strokeWidth={1.75} />
          Start a check
        </Link>
      )}
    </div>
  );
}

export function HistoryRail({ variant = 'rail' }: HistoryRailProps) {
  const { history, clearHistory, newCase, openHistoryItem, runAnalysis } = useCase();
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const page = variant === 'page';

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return history;
    return history.filter((item) =>
      [item.title, item.summary, item.evidence, item.caseId ?? '', item.reportId ?? ''].some((value) =>
        value.toLowerCase().includes(normalized)
      )
    );
  }, [history, query]);

  const groups = useMemo(() => groupHistory(filtered), [filtered]);

  function startNewCheck() {
    if (location.pathname === '/') {
      window.dispatchEvent(new Event('vmi:new-check'));
    } else {
      newCase();
    }
    navigate('/');
  }

  async function openItem(item: HistoryItem) {
    setOpeningId(item.id);
    const opened = await openHistoryItem(item.id);
    setOpeningId(null);
    if (opened) {
      navigate('/');
      return;
    }
    newCase();
    navigate('/');
    if (item.evidence.trim()) void runAnalysis(item.evidence);
  }

  return (
    <section aria-label="Conversation history" className={page ? 'mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8' : 'flex min-h-0 flex-1 flex-col'}>
      <div className={page ? 'mb-5 flex items-center justify-between gap-3' : 'px-3 pb-2'}>
        <button
          type="button"
          onClick={startNewCheck}
          className="inline-flex w-full items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 text-sm text-slate-100 transition hover:border-accent/50 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <SquarePen className="h-4 w-4" strokeWidth={1.75} />
          New check
        </button>
        {page && history.length > 0 && (
          <button
            type="button"
            onClick={clearHistory}
            aria-label="Clear local history"
            className="shrink-0 rounded-lg p-2 text-faint transition hover:bg-ink-850 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className={page ? 'relative mb-4' : 'relative px-3 pb-2'}>
          <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search history"
            placeholder="Search history"
            className="h-9 w-full rounded-lg border border-line bg-ink-900 pl-8 pr-3 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      )}

      <div className={page ? 'space-y-5' : 'min-h-0 flex-1 overflow-y-auto px-2 pb-3'}>
        {history.length === 0 ? (
          <EmptyState variant={variant} />
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-sm text-faint">No matching history.</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className={page ? 'space-y-1.5' : 'mb-3 space-y-1'}>
              <p className="px-2 pb-1 font-mono text-[11px] uppercase text-faint">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.kind === 'report' ? Flag : MessageSquare;
                const riskClass = item.riskLevel ? RISK_TEXT[item.riskLevel] : 'text-faint';
                const opening = openingId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openItem(item)}
                    className={`group flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-ink-850 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      page ? 'border-b border-line/50 last:border-b-0' : ''
                    }`}
                  >
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint group-hover:text-slate-200">
                      {opening ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.75} />
                      ) : (
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-200">{item.title}</span>
                      <span className="mt-0.5 block truncate text-xs leading-5 text-muted">{itemPreview(item, page ? 180 : 74)}</span>
                      <span className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[11px]">
                        <span className={riskClass}>{itemMeta(item)}</span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-faint">
                          <Clock3 className="h-3 w-3" strokeWidth={1.75} />
                          <span className="truncate">{formatTime(item.createdAt)}</span>
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
