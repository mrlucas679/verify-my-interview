import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Gavel,
  Search,
  ListChecks,
  Network as NetworkIcon,
  BookCheck,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Share2,
  Check,
  Volume2,
  Square,
  ShieldCheck,
  ScaleIcon,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import { useCase, type CaseEntry } from '../store/caseStore';
import { shareReport, submitReport } from '../lib/api';
import { reportNarration } from '../lib/communication';
import type { AnalyzeResponse, RiskLevel, RiskReport } from '../lib/types';
import { Composer, type ReportInput } from '../components/Composer';
import { IntelCard } from '../components/IntelCard';
import { VerdictCard } from '../components/VerdictCard';
import { InvestigationLayers } from '../components/InvestigationLayers';
import { Findings } from '../components/Findings';
import { NetworkMatches } from '../components/NetworkMatches';
import { GuidanceCitations } from '../components/GuidanceCitations';
import { EvidenceGraph } from '../components/EvidenceGraph';
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
  'Reading the message and pulling out names, links, and contact details',
  'Checking company, domain, phone, and payment clues',
  'Looking for public evidence that confirms or contradicts the offer',
  'Comparing identifiers with prior scam reports',
  'Reviewing the proof and writing a clear verdict',
];

const TRUST_MARKERS: { icon: LucideIcon; label: string }[] = [
  { icon: ScaleIcon, label: 'Score comes from evidence, not guesswork' },
  { icon: BookCheck, label: 'Advice cites FTC, IC3, and BBB guidance' },
  { icon: ShieldCheck, label: 'Sensitive identifiers are redacted before analysis' },
];

function verdictDigest(report: RiskReport): string {
  const lines = [
    `${report.risk_level} — risk ${report.risk_score}/100, confidence ${Math.round(report.confidence * 100)}%`,
    '',
    report.case_summary,
  ];
  if (report.red_flags.length) lines.push('', 'Red flags:', ...report.red_flags.map((f) => `- ${f}`));
  return lines.join('\n');
}

/** Share + Read-aloud for the latest completed verdict (header actions). */
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
        /* clipboard blocked; link still resolvable */
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
    const u = new SpeechSynthesisUtterance(reportNarration(report));
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }

  const ShareIcon = shareState === 'copied' ? Check : Share2;
  const shareLabel =
    shareState === 'sharing' ? 'Saving…' : shareState === 'copied' ? 'Copied' : shareState === 'error' ? 'Unavailable' : 'Share';

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

function RunningCard() {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setStep((s) => (s + 1) % RUN_STEPS.length), 1100);
    return () => clearInterval(t);
  }, [reduceMotion]);
  return (
    <div className="surface flex items-center gap-4 p-5" role="status" aria-live="polite">
      <Loader2 className="h-6 w-6 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-100">Investigating…</p>
        <p className="truncate font-mono text-xs text-muted">{RUN_STEPS[reduceMotion ? 0 : step]}</p>
      </div>
    </div>
  );
}

/** Render one completed verify result as a group of intelligence cards. */
function ResultGroup({ result, isLatest }: { result: AnalyzeResponse; isLatest: boolean }) {
  const { report, trace, signals, matches, graph } = result;
  const hasNetwork = (graph && graph.nodes.length > 1) || matches.length > 0;
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

      <IntelCard icon={Search} title="Investigation" tint="accent" defaultExpanded={false}>
        <InvestigationLayers trace={trace} />
      </IntelCard>

      <IntelCard icon={ListChecks} title="Why this score" tint="default">
        <Findings signals={signals} />
      </IntelCard>

      {hasNetwork && (
        <IntelCard icon={NetworkIcon} title="Intelligence network" tint="default" defaultExpanded={false}>
          {graph && graph.nodes.length > 1 && (
            <div className="mb-3">
              <EvidenceGraph graph={graph} height={360} />
              <p className="mt-2 text-xs text-faint">
                These identifiers connect to earlier reports. Select a node to inspect the proof.
              </p>
            </div>
          )}
          {matches.length > 0 && <NetworkMatches matches={matches} />}
        </IntelCard>
      )}

      {report.guidance_citations?.length > 0 && (
        <IntelCard icon={BookCheck} title="Official guidance" tint="default" defaultExpanded={false}>
          <GuidanceCitations citations={report.guidance_citations} />
        </IntelCard>
      )}

      {report.recommended_next_steps.length > 0 && (
        <IntelCard icon={ListChecks} title="Recommended next steps" tint="accent">
          <ol className="space-y-2">
            {report.recommended_next_steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-slate-300">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] text-accent">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
          {report.missing_evidence.length > 0 && (
            <div className="surface-2 mt-3 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted">To make the verdict stronger, add</p>
              <ul className="space-y-1">
                {report.missing_evidence.map((m, i) => (
                  <li key={i} className="text-xs text-faint">{m}</li>
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
          <p className="font-medium">We couldn’t file that report.</p>
          <p className="mt-1 text-risk-scam/90">{ack.error}</p>
        </div>
      </div>
    );
  }
  return (
    <IntelCard
      icon={ack.status === 'submitting' ? Loader2 : CheckCircle2}
      title={ack.status === 'submitting' ? 'Filing report…' : 'Report received — thank you'}
      tint="low"
      meta={ack.reportId ?? undefined}
    >
      {ack.status === 'submitting' ? (
        <p className="text-sm text-muted">Submitting your report to the scam-intelligence network…</p>
      ) : (
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            Your report{ack.reportId ? <span className="font-mono text-xs text-faint"> ({ack.reportId})</span> : ''} has
            been received. We’ll verify the details and the next person who checks this recruiter’s email, domain, or
            number will see the match. You won’t get an individual investigation result back.
          </p>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">While you’re here — stay safe:</p>
            <ul className="space-y-1 text-xs text-faint">
              <li>Don’t send money, gift cards, crypto, ID documents, or banking details.</li>
              <li>If you already paid, contact your bank or card provider now — speed matters.</li>
              <li>Keep the messages, receipts, numbers, and links as evidence before blocking.</li>
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
  const { entries, result, runAnalysis, newCase } = useCase();
  const [acks, setAcks] = useState<ReportAck[]>([]);
  const reportAborts = useRef<Map<string, AbortController>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const live = reportAborts.current;
    return () => {
      for (const c of live.values()) c.abort();
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
      { id, kind: 'report', company: input.company, reportId: null, status: 'submitting', error: null, createdAt: Date.now() },
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
      setAcks((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'done', reportId } : a)));
    } catch (e) {
      if (controller.signal.aborted) return;
      const message = e instanceof Error ? e.message : 'Could not file the report.';
      setAcks((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'error', error: message } : a)));
    } finally {
      reportAborts.current.delete(id);
    }
  }, []);

  const reporting = useMemo(() => acks.some((a) => a.status === 'submitting'), [acks]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [
      ...entries.map((entry): TimelineItem => ({ type: 'verify', entry, createdAt: entry.createdAt })),
      ...acks.map((ack): TimelineItem => ({ type: 'report', ack, createdAt: ack.createdAt })),
    ];
    return items.sort((a, b) => a.createdAt - b.createdAt);
  }, [entries, acks]);

  const active = timeline.length > 0;
  const latestDoneId = useMemo(() => {
    const done = entries.filter((e) => e.status === 'done');
    return done.length ? done[done.length - 1].id : null;
  }, [entries]);

  // Keep the newest card group in view as the stack grows.
  useEffect(() => {
    if (active && !reduceMotion) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [timeline.length, active, reduceMotion]);

  function startNew() {
    for (const c of reportAborts.current.values()) c.abort();
    reportAborts.current.clear();
    setAcks([]);
    newCase();
  }

  return (
    <div className="bg-grid min-h-[calc(100vh-4rem)]">
      <div className="mx-auto flex max-w-3xl flex-col px-6 pb-10 pt-10">
        {!active ? (
          /* ── Empty / first-run ─────────────────────────────────────────── */
          <div className="pt-6">
            <header className="text-center">
              <span className="eyebrow">Job-offer safety check</span>
              <h1 className="mt-3 font-display text-3xl font-semibold leading-[1.12] tracking-tight text-white sm:text-[2.4rem]">
                Check a job, recruiter, or offer before you trust it.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
                Paste a message, drop a screenshot or PDF, or record what happened. We check the recruiter, domain,
                payment request, and prior scam patterns — then explain what’s safe, risky, or still uncertain.
              </p>
            </header>
            <div className="mx-auto mt-8 w-full max-w-2xl">
              <Composer onVerify={handleVerify} onReport={handleReport} reporting={reporting} />
            </div>
            <ul className="mt-6 flex flex-col items-center gap-x-6 gap-y-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
              {TRUST_MARKERS.map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.label} className="flex items-center gap-2 text-xs text-faint">
                    <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.75} /> {t.label}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          /* ── Active workspace ──────────────────────────────────────────── */
          <>
            <div className="mb-4 flex items-center justify-between">
              <span className="eyebrow">Investigation workspace</span>
              <button type="button" onClick={startNew} className="btn-ghost text-sm">
                <Plus className="h-4 w-4" strokeWidth={1.75} /> New case
              </button>
            </div>

            <div className="space-y-6">
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
                >
                  {item.type === 'report' ? (
                    <ReportAckCard
                      ack={item.ack}
                      onAlsoCheck={() => {
                        // Re-run the reported text through Verify isn't stored here;
                        // prompt the user to paste — keep it explicit and simple.
                        document.getElementById('workspace-composer')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                    />
                  ) : item.entry.status === 'running' ? (
                    <RunningCard />
                  ) : item.entry.status === 'error' ? (
                    <div role="alert" className="surface flex items-start gap-3 border-risk-scam/40 p-5 text-sm text-risk-scam">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
                      <div>
                        <p className="font-medium">We couldn’t complete this check.</p>
                        <p className="mt-1 text-risk-scam/90">{item.entry.error}</p>
                      </div>
                    </div>
                  ) : item.entry.result ? (
                    <ResultGroup result={item.entry.result} isLatest={item.entry.id === latestDoneId} />
                  ) : null}
                </motion.div>
              ))}
            </div>

            {/* Ask the detective about the latest completed case */}
            {result && (
              <div className="mt-6">
                <ChatPanel />
              </div>
            )}

            {/* Docked composer */}
            <div id="workspace-composer" ref={bottomRef} className="mt-6">
              <Composer onVerify={handleVerify} onReport={handleReport} reporting={reporting} docked />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
