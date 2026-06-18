import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock3,
  FileText,
  Flag,
  History as HistoryIcon,
  RotateCcw,
  Search,
  ShieldQuestion,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useCase, type HistoryItem } from '../store/caseStore';
import type { RiskLevel } from '../lib/types';

const RISK_TEXT: Record<RiskLevel, string> = {
  'Low Risk': 'text-risk-low',
  'Needs More Verification': 'text-risk-needs',
  Suspicious: 'text-risk-suspicious',
  'Likely Scam': 'text-risk-scam',
  Inconclusive: 'text-risk-inconclusive',
};

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function evidencePreview(evidence: string): string {
  const clean = evidence.replace(/\s+/g, ' ').trim();
  if (clean.length <= 220) return clean;
  return `${clean.slice(0, 220).trim()}...`;
}

function ItemIcon({ item }: { item: HistoryItem }) {
  const Icon: LucideIcon = item.kind === 'report' ? Flag : ShieldQuestion;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-ink-800 text-muted">
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}

function HistoryCard({ item, onCheckAgain }: { item: HistoryItem; onCheckAgain: (item: HistoryItem) => void }) {
  return (
    <article className="surface p-4 transition hover:border-accent/40">
      <div className="flex gap-3">
        <ItemIcon item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-display text-base font-semibold text-white">{item.title}</p>
            {item.kind === 'report' ? (
              <span className="rounded-md border border-line bg-ink-900 px-2 py-0.5 font-mono text-[11px] text-muted">
                Report
              </span>
            ) : item.riskLevel ? (
              <span className={`font-mono text-[11px] ${RISK_TEXT[item.riskLevel]}`}>
                {item.riskLevel}
                {typeof item.riskScore === 'number' ? ` · ${item.riskScore}/100` : ''}
              </span>
            ) : null}
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.summary}</p>
          <p className="mt-3 rounded-lg border border-line/70 bg-ink-900 px-3 py-2 text-xs leading-relaxed text-faint">
            {evidencePreview(item.evidence)}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-faint">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" strokeWidth={1.75} />
                {formatDate(item.createdAt)}
              </span>
              {item.caseId && <span>{item.caseId}</span>}
              {item.reportId && <span>{item.reportId}</span>}
            </div>
            <button type="button" onClick={() => onCheckAgain(item)} className="btn-ghost px-3 py-2 text-xs">
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Check again
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyHistory() {
  return (
    <div className="surface grid min-h-[320px] place-items-center p-6 text-center">
      <div className="max-w-sm">
        <HistoryIcon className="mx-auto h-8 w-8 text-muted" strokeWidth={1.75} />
        <h2 className="mt-4 font-display text-xl font-semibold text-white">No history yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Checks and filed reports from this browser will appear here.
        </p>
        <Link to="/" className="btn-primary mt-5">
          <FileText className="h-4 w-4" strokeWidth={1.75} />
          Start a check
        </Link>
      </div>
    </div>
  );
}

export function History() {
  const { history, clearHistory, newCase, runAnalysis } = useCase();
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return history;
    return history.filter((item) =>
      [item.title, item.summary, item.evidence, item.caseId ?? '', item.reportId ?? '']
        .some((value) => value.toLowerCase().includes(normalized))
    );
  }, [history, query]);

  function checkAgain(item: HistoryItem) {
    newCase();
    navigate('/');
    void runAnalysis(item.evidence);
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5">
          <p className="eyebrow">History</p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="font-display text-2xl font-semibold text-white sm:text-3xl">Past checks</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Your previous checks and reports saved on this browser.
              </p>
            </div>
            {history.length > 0 && (
              <button type="button" onClick={clearHistory} className="btn-ghost self-start px-3 py-2 text-xs">
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Clear
              </button>
            )}
          </div>
        </header>

        {history.length === 0 ? (
          <EmptyHistory />
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search past checks"
                className="w-full rounded-xl border border-line bg-ink-850 py-3 pl-10 pr-3 text-sm text-slate-100 placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
            </div>

            {filtered.length > 0 ? (
              <div className="space-y-3">
                {filtered.map((item) => (
                  <HistoryCard key={item.id} item={item} onCheckAgain={checkAgain} />
                ))}
              </div>
            ) : (
              <div className="surface p-6 text-center text-sm text-muted">No matching history.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
