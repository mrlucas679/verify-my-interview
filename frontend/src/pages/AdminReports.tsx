import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { listPendingReports, moderateReport, type PendingReport } from '../lib/api';
import { useAuth } from '../lib/auth';

function compact(value: string, max = 260): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trim()}...`;
}

function submittedAt(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

function ReportRow({
  report,
  busy,
  onModerate,
}: {
  report: PendingReport;
  busy: boolean;
  onModerate: (reportId: string, action: 'approve' | 'reject') => void;
}) {
  const indicators = useMemo(
    () => [...report.domains, ...report.emails, ...(report.phones ?? [])].slice(0, 5),
    [report.domains, report.emails, report.phones]
  );

  return (
    <article className="surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-base font-semibold text-white">{report.companyName}</h2>
            <span className="rounded-md border border-line bg-ink-900 px-2 py-0.5 font-mono text-[11px] text-faint">
              {report.reportId}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-faint">{submittedAt(report.submittedAt)}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">{compact(report.description)}</p>
          {indicators.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {indicators.map((item) => (
                <span key={item} className="rounded-md border border-line/70 bg-ink-900 px-2 py-1 font-mono text-[11px] text-faint">
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onModerate(report.reportId, 'reject')}
            disabled={busy}
            className="btn-ghost px-3 py-2 text-xs text-risk-needs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" strokeWidth={1.75} />}
            Reject
          </button>
          <button
            type="button"
            onClick={() => onModerate(report.reportId, 'approve')}
            disabled={busy}
            className="btn-primary px-3 py-2 text-xs"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
            Approve
          </button>
        </div>
      </div>
    </article>
  );
}

export function AdminReports() {
  const auth = useAuth();
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.authenticated || !auth.isAdmin) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listPendingReports({ signal: controller.signal })
      .then((data) => setReports(data.reports))
      .catch((event: unknown) => {
        if (controller.signal.aborted) return;
        setError(event instanceof Error ? event.message : 'Could not load reports.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [auth.authenticated, auth.isAdmin]);

  async function handleModerate(reportId: string, action: 'approve' | 'reject') {
    setBusyId(reportId);
    setError(null);
    try {
      await moderateReport(reportId, action);
      setReports((current) => current.filter((report) => report.reportId !== reportId));
    } catch (event) {
      setError(event instanceof Error ? event.message : 'Could not update that report.');
    } finally {
      setBusyId(null);
    }
  }

  if (!auth.enabled) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted sm:px-6">
        Administration is not configured on this deployment.
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-3xl place-items-center px-4 py-8 text-center sm:px-6">
        <div>
          <ShieldCheck className="mx-auto h-8 w-8 text-muted" strokeWidth={1.75} />
          <h1 className="mt-4 font-display text-2xl font-semibold text-white">Admin review</h1>
          <button type="button" onClick={() => void auth.signIn()} className="btn-primary mt-5">
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (!auth.isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted sm:px-6">
        Administrator access is required.
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-5">
          <p className="eyebrow">Admin</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-white sm:text-3xl">Report review</h1>
        </header>

        {error && (
          <p className="mb-4 rounded-lg border border-risk-needs/40 bg-risk-needs/10 p-3 text-sm text-risk-needs" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.75} />
            Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="surface p-6 text-center text-sm text-muted">No reports waiting for review.</div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <ReportRow
                key={report.reportId}
                report={report}
                busy={busyId === report.reportId}
                onModerate={(reportId, action) => void handleModerate(reportId, action)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
