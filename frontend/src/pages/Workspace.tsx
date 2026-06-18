import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  BookCheck,
  Building2,
  Check,
  CheckCircle2,
  Clipboard,
  FileText,
  FileSearch,
  Gavel,
  History as HistoryIcon,
  ListChecks,
  Loader2,
  MailWarning,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Square,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { useCase, type CaseEntry } from '../store/caseStore';
import { shareReport, submitReport } from '../lib/api';
import { reportNarration } from '../lib/communication';
import type { AnalyzeResponse, Entities, RiskLevel, RiskReport } from '../lib/types';
import { Composer, type ReportInput } from '../components/Composer';
import { IntelCard } from '../components/IntelCard';
import { VerdictCard } from '../components/VerdictCard';
import { InvestigationLayers } from '../components/InvestigationLayers';
import { Findings } from '../components/Findings';
import { SimilarReports } from '../components/SimilarReports';
import { GuidanceCitations } from '../components/GuidanceCitations';
import { ChatPanel } from '../components/ChatPanel';

type IntelTint = 'scam' | 'suspicious' | 'needs' | 'low' | 'inconclusive';

const LEVEL_TINT: Record<RiskLevel, IntelTint> = {
  'Likely Scam': 'scam',
  Suspicious: 'suspicious',
  'Needs More Verification': 'needs',
  'Low Risk': 'low',
  Inconclusive: 'inconclusive',
};

const RUN_STEPS = [
  'Extracting names, links, contacts, and payment clues',
  'Checking company and recruiter identifiers',
  'Reviewing domains, email headers, and document text',
  'Looking for similar reports',
  'Composing evidence-backed recommendations',
];

const TRUST_MARKERS: { icon: LucideIcon; label: string }[] = [
  { icon: ShieldCheck, label: 'Evidence is redacted before analysis' },
  { icon: BookCheck, label: 'Guidance cites official sources' },
  { icon: HistoryIcon, label: 'Checks are saved to history' },
];

function verdictDigest(report: RiskReport): string {
  const lines = [
    `${report.risk_level} - risk ${report.risk_score}/100, confidence ${Math.round(report.confidence * 100)}%`,
    '',
    report.case_summary,
  ];
  if (report.red_flags.length) lines.push('', 'Red flags:', ...report.red_flags.map((flag) => `- ${flag}`));
  return lines.join('\n');
}

function compactEvidence(evidence: string): string {
  const clean = evidence.replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= 900) return clean;
  return `${clean.slice(0, 900).trim()}...`;
}

function evidenceMeta(evidence: string): string {
  const attachments = evidence.match(/^Attachment:/gm)?.length ?? 0;
  const chars = evidence.trim().length;
  if (attachments > 0) return `${attachments} attachment${attachments === 1 ? '' : 's'} - ${chars.toLocaleString()} chars`;
  return `${chars.toLocaleString()} chars`;
}

function formatList(values: string[], empty: string): ReactNode {
  const items = values.filter(Boolean).slice(0, 6);
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((value) => (
        <li key={value} className="rounded-lg border border-line bg-ink-900 px-3 py-2 font-mono text-xs text-slate-300">
          {value}
        </li>
      ))}
    </ul>
  );
}

function EntityGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{label}</p>
      {formatList(values, 'No identifiers found.')}
    </div>
  );
}

function CompanyIntel({ report }: { report: RiskReport }) {
  const companies = report.entities.companies.slice(0, 6);
  const facts = report.verified_facts.slice(0, 5);
  const positives = report.positive_signals.slice(0, 4);
  return (
    <div className="grid gap-3 md:grid-cols-[0.85fr_1.15fr]">
      <div className="surface-2 p-3">
        <p className="mb-2 text-xs font-medium text-muted">Claimed companies</p>
        {formatList(companies, 'No company name was clear in the evidence.')}
      </div>
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Verified facts</p>
          {facts.length ? (
            <ul className="space-y-1.5 text-sm text-slate-300">
              {facts.map((fact) => (
                <li key={fact} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-risk-low" strokeWidth={1.75} />
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No verified company facts were strong enough to rely on.</p>
          )}
        </div>
        {positives.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Legitimacy signals</p>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {positives.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function EvidenceIntel({ entities }: { entities: Entities }) {
  const groups = [
    { label: 'Emails', values: entities.emails },
    { label: 'Domains', values: entities.domains },
    { label: 'URLs', values: entities.urls },
    { label: 'Phones', values: entities.phones },
    { label: 'Money requests', values: entities.money_requests },
    { label: 'Job titles', values: entities.job_titles },
  ];
  const visible = groups.filter((group) => group.values.length > 0).slice(0, 6);
  if (visible.length === 0) {
    return <p className="text-sm text-muted">No structured identifiers were extracted from this evidence packet.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map((group) => (
        <EntityGroup key={group.label} label={group.label} values={group.values} />
      ))}
    </div>
  );
}

function VerdictActions({ result, report }: { result: AnalyzeResponse; report: RiskReport }) {
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<number | null>(null);
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (speechSupported) window.speechSynthesis.cancel();
    },
    [speechSupported]
  );

  async function share() {
    if (shareState === 'sharing') return;
    setShareState('sharing');
    try {
      const { id } = await shareReport(result);
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/s/${id}`);
      } catch {
        /* Clipboard access can be blocked; the server-side share still exists. */
      }
      setShareState('copied');
    } catch {
      setShareState('error');
    }
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShareState('idle'), 3000);
  }

  function toggleSpeak() {
    if (!speechSupported) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(reportNarration(report));
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  const ShareIcon = shareState === 'copied' ? Check : Share2;
  const shareLabel =
    shareState === 'sharing' ? 'Saving' : shareState === 'copied' ? 'Copied' : shareState === 'error' ? 'Unavailable' : 'Share';

  return (
    <>
      <button
        type="button"
        onClick={share}
        disabled={shareState === 'sharing'}
        aria-label="Save and copy a shareable link to this report"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
      >
        <ShareIcon className="h-3.5 w-3.5" strokeWidth={1.75} /> {shareLabel}
      </button>
      {speechSupported && (
        <button
          type="button"
          onClick={toggleSpeak}
          aria-pressed={speaking}
          aria-label={speaking ? 'Stop reading aloud' : 'Read the verdict aloud'}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {speaking ? <Square className="h-3.5 w-3.5" strokeWidth={1.75} /> : <Volume2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
        </button>
      )}
    </>
  );
}

function UserEvidencePacket({ evidence }: { evidence: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] rounded-2xl border border-line bg-ink-800 px-4 py-3 shadow-card sm:max-w-[84%]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
            <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
            Evidence packet
          </span>
          <span className="font-mono text-[11px] text-faint">{evidenceMeta(evidence)}</span>
        </div>
        <p className="max-h-36 overflow-hidden whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
          {compactEvidence(evidence)}
        </p>
      </div>
    </div>
  );
}

function RunningCard() {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setInterval(() => setStep((current) => (current + 1) % RUN_STEPS.length), 1100);
    return () => clearInterval(timer);
  }, [reduceMotion]);

  return (
    <div className="surface flex items-start gap-4 p-5" role="status" aria-live="polite">
      <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-100">Investigation running</p>
        <p className="mt-1 font-mono text-xs text-muted">{RUN_STEPS[reduceMotion ? 0 : step]}</p>
      </div>
    </div>
  );
}

function ResultGroup({ result, isLatest }: { result: AnalyzeResponse; isLatest: boolean }) {
  const { report, trace, signals, matches } = result;
  return (
    <div className="space-y-3">
      <IntelCard
        icon={Gavel}
        title="Verdict"
        tint={LEVEL_TINT[report.risk_level]}
        meta={`${report.risk_score}/100`}
        copyText={verdictDigest(report)}
        actions={isLatest ? <VerdictActions result={result} report={report} /> : undefined}
      >
        <VerdictCard report={report} />
      </IntelCard>

      <IntelCard icon={Building2} title="Company verification" tint="accent" defaultExpanded={false}>
        <CompanyIntel report={report} />
      </IntelCard>

      <IntelCard icon={MailWarning} title="Evidence and identifiers" tint="default" defaultExpanded={false}>
        <EvidenceIntel entities={report.entities} />
      </IntelCard>

      <IntelCard icon={ListChecks} title="Why this score" tint="default">
        <Findings signals={signals} />
      </IntelCard>

      <IntelCard icon={Search} title="Investigation trace" tint="accent" defaultExpanded={false}>
        <InvestigationLayers trace={trace} />
      </IntelCard>

      {matches.length > 0 && (
        <IntelCard icon={FileSearch} title="Similar reports" tint="default" defaultExpanded={false}>
          <SimilarReports matches={matches} />
        </IntelCard>
      )}

      {report.guidance_citations?.length > 0 && (
        <IntelCard icon={BookCheck} title="Official guidance" tint="default" defaultExpanded={false}>
          <GuidanceCitations citations={report.guidance_citations} />
        </IntelCard>
      )}

      {report.recommended_next_steps.length > 0 && (
        <IntelCard icon={Clipboard} title="Recommended next steps" tint="accent">
          <ol className="space-y-2">
            {report.recommended_next_steps.slice(0, 8).map((step, index) => (
              <li key={step} className="flex gap-2.5 text-sm text-slate-300">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] text-accent">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          {report.missing_evidence.length > 0 && (
            <div className="surface-2 mt-3 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted">To make the verdict stronger, add</p>
              <ul className="space-y-1">
                {report.missing_evidence.slice(0, 6).map((missing) => (
                  <li key={missing} className="text-xs text-faint">
                    {missing}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </IntelCard>
      )}
    </div>
  );
}

interface ReportAck {
  id: string;
  kind: 'report';
  company: string;
  evidence: string;
  reportId: string | null;
  status: 'submitting' | 'done' | 'error';
  error: string | null;
  createdAt: number;
}

function ReportAckCard({ ack, onAlsoCheck }: { ack: ReportAck; onAlsoCheck: () => void }) {
  if (ack.status === 'error') {
    return (
      <div role="alert" className="surface flex items-start gap-3 border-risk-scam/40 p-5 text-sm text-risk-scam">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
        <div>
          <p className="font-medium">We could not file that report.</p>
          <p className="mt-1 text-risk-scam/90">{ack.error}</p>
        </div>
      </div>
    );
  }

  return (
    <IntelCard
      icon={ack.status === 'submitting' ? Loader2 : CheckCircle2}
      title={ack.status === 'submitting' ? 'Filing report' : 'Report received'}
      tint="low"
      meta={ack.reportId ?? undefined}
    >
      {ack.status === 'submitting' ? (
        <p className="text-sm text-muted">Saving your report.</p>
      ) : (
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            Your report{ack.reportId ? <span className="font-mono text-xs text-faint"> ({ack.reportId})</span> : ''} has
            been received. It can help future checks spot the same company, domain, email, phone, or payment clue.
          </p>
          <div className="surface-2 p-3">
            <p className="mb-1.5 text-xs font-medium text-muted">Safety next steps</p>
            <ul className="space-y-1 text-xs text-faint">
              <li>Do not send money, gift cards, crypto, ID documents, or banking details.</li>
              <li>If you already paid, contact your bank or card provider now.</li>
              <li>Keep messages, receipts, numbers, links, and file names before blocking.</li>
            </ul>
          </div>
          <button type="button" onClick={onAlsoCheck} className="btn-ghost text-sm">
            Also check this for me
          </button>
        </div>
      )}
    </IntelCard>
  );
}

type TimelineItem =
  | { type: 'verify'; entry: CaseEntry; createdAt: number }
  | { type: 'report'; ack: ReportAck; createdAt: number };

export function Workspace() {
  const { entries, result, runAnalysis, recordReport, newCase } = useCase();
  const [acks, setAcks] = useState<ReportAck[]>([]);
  const reportAborts = useRef<Map<string, AbortController>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const live = reportAborts.current;
    return () => {
      for (const controller of live.values()) controller.abort();
      live.clear();
    };
  }, []);

  const handleVerify = useCallback(
    (evidence: string) => {
      void runAnalysis(evidence);
    },
    [runAnalysis]
  );

  const handleReport = useCallback(async (input: ReportInput) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Date.now()}`;
    const controller = new AbortController();
    reportAborts.current.set(id, controller);
    setAcks((prev) => [
      ...prev,
      {
        id,
        kind: 'report',
        company: input.company,
        evidence: input.evidence,
        reportId: null,
        status: 'submitting',
        error: null,
        createdAt: Date.now(),
      },
    ]);
    try {
      const { reportId } = await submitReport(
        {
          companyName: input.company,
          description: input.evidence,
          location: input.location || undefined,
          emails: input.emails,
          domains: input.domains,
          phones: input.phones,
        },
        { signal: controller.signal }
      );
      setAcks((prev) => prev.map((ack) => (ack.id === id ? { ...ack, status: 'done', reportId } : ack)));
      recordReport({ company: input.company, evidence: input.evidence, reportId });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Could not file the report.';
      setAcks((prev) => prev.map((ack) => (ack.id === id ? { ...ack, status: 'error', error: message } : ack)));
    } finally {
      reportAborts.current.delete(id);
    }
  }, [recordReport]);

  const reporting = useMemo(() => acks.some((ack) => ack.status === 'submitting'), [acks]);
  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...entries.map((entry): TimelineItem => ({ type: 'verify', entry, createdAt: entry.createdAt })),
      ...acks.map((ack): TimelineItem => ({ type: 'report', ack, createdAt: ack.createdAt })),
    ];
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }, [acks, entries]);
  const active = timeline.length > 0;
  const latestDoneId = useMemo(() => {
    const done = entries.filter((entry) => entry.status === 'done');
    return done.length ? done[done.length - 1].id : null;
  }, [entries]);

  useEffect(() => {
    if (active && !reduceMotion) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active, reduceMotion, timeline.length]);

  function startNew() {
    for (const controller of reportAborts.current.values()) controller.abort();
    reportAborts.current.clear();
    setAcks([]);
    newCase();
  }

  if (!active) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col justify-center px-4 py-8 sm:px-6">
          <header className="mb-6 text-center">
            <p className="eyebrow">Investigation workspace</p>
            <h1 className="mt-3 font-display text-3xl font-semibold leading-tight text-white sm:text-4xl">
              What do you want to check?
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
              Paste the whole situation, attach files, add a voice note, or report what happened. One evidence packet is
              enough.
            </p>
          </header>
          <Composer onVerify={handleVerify} onReport={handleReport} reporting={reporting} />
          <ul className="mt-5 flex flex-col items-center gap-x-6 gap-y-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
            {TRUST_MARKERS.map((marker) => {
              const Icon = marker.icon;
              return (
                <li key={marker.label} className="flex items-center gap-2 text-xs text-faint">
                  <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} /> {marker.label}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 sm:px-6">
        <div className="flex-1 py-6 sm:py-8">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Workspace</p>
              <h1 className="mt-1 font-display text-xl font-semibold text-white">Current investigation</h1>
            </div>
            <button type="button" onClick={startNew} className="btn-ghost text-sm">
              <Plus className="h-4 w-4" strokeWidth={1.75} /> New case
            </button>
          </div>

          <div className="space-y-5">
            {timeline.map((item) => (
              <motion.div
                key={item.type === 'verify' ? item.entry.id : item.ack.id}
                {...(reduceMotion
                  ? {}
                  : {
                      initial: { opacity: 0, y: 8 },
                      animate: { opacity: 1, y: 0 },
                      transition: { duration: 0.22, ease: 'easeOut' as const },
                    })}
                className="space-y-3"
              >
                {item.type === 'report' ? (
                  <>
                    <UserEvidencePacket evidence={item.ack.evidence} />
                    <ReportAckCard ack={item.ack} onAlsoCheck={() => handleVerify(item.ack.evidence)} />
                  </>
                ) : (
                  <>
                    <UserEvidencePacket evidence={item.entry.evidence} />
                    {item.entry.status === 'running' ? (
                      <RunningCard />
                    ) : item.entry.status === 'error' ? (
                      <div role="alert" className="surface flex items-start gap-3 border-risk-scam/40 p-5 text-sm text-risk-scam">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                        <div>
                          <p className="font-medium">We could not complete this check.</p>
                          <p className="mt-1 text-risk-scam/90">{item.entry.error}</p>
                        </div>
                      </div>
                    ) : item.entry.result ? (
                      <ResultGroup result={item.entry.result} isLatest={item.entry.id === latestDoneId} />
                    ) : null}
                  </>
                )}
              </motion.div>
            ))}
          </div>

          {result && (
            <div className="mt-6">
              <ChatPanel />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line/70 bg-ink-900/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
          <Composer onVerify={handleVerify} onReport={handleReport} reporting={reporting} docked />
        </div>
      </div>
    </div>
  );
}
