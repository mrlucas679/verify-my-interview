import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  Clipboard,
  ExternalLink,
  Loader2,
  Share2,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from 'lucide-react';
import { useCase, type CaseEntry } from '../store/caseStore';
import { ApiError, chat, shareReport, storeEvidence, submitReport, type CaseContext, type ChatMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { reportNarration } from '../lib/communication';
import type { AnalyzeResponse, RiskLevel, RiskReport, StructuredSignal } from '../lib/types';
import { Composer, type ComposerEvidenceFile, type ReportInput } from '../components/Composer';

const RISK_TONE: Record<RiskLevel, string> = {
  'Likely Scam': 'text-risk-scam',
  Suspicious: 'text-risk-suspicious',
  'Needs More Verification': 'text-risk-needs',
  'Low Risk': 'text-risk-low',
  Inconclusive: 'text-risk-inconclusive',
};

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
  const clean = evidence
    .replace(/^User message\s*\n+/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (clean.length <= 900) return clean;
  return `${clean.slice(0, 900).trim()}...`;
}

function detectiveFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CLIENT_TIMEOUT') {
      return 'I could not finish that reply in time. Ask one shorter question and I will try again.';
    }
    if (error.code === 'CHAT_BAD_PAYLOAD') {
      return 'I could not read this case well enough to answer safely. Start a new check, then ask again.';
    }
    if (error.status >= 500 || error.code === 'CHAT_RUNTIME_ERROR') {
      return 'I cannot answer this follow-up right now. The report is still available, and you can try again in a moment.';
    }
  }
  return error instanceof Error ? error.message : 'I cannot answer this follow-up right now. Please try again.';
}

function VerdictActions({ result, report }: { result: AnalyzeResponse; report: RiskReport }) {
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const timer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      if (speechSupported) window.speechSynthesis.cancel();
    },
    [speechSupported]
  );

  async function copyVerdict() {
    try {
      await navigator.clipboard.writeText(verdictDigest(report));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), 2500);
  }

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
  const CopyIcon = copyState === 'copied' ? Check : Clipboard;
  const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Unavailable' : 'Copy';
  const shareLabel =
    shareState === 'sharing' ? 'Saving' : shareState === 'copied' ? 'Copied' : shareState === 'error' ? 'Unavailable' : 'Share';

  return (
    <>
      <button
        type="button"
        onClick={copyVerdict}
        aria-label="Copy the verdict summary"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <CopyIcon className="h-3.5 w-3.5" strokeWidth={1.75} /> {copyLabel}
      </button>
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
      <button
        type="button"
        onClick={() => setFeedback('helpful')}
        aria-pressed={feedback === 'helpful'}
        aria-label="Mark this investigation helpful"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 aria-pressed:text-risk-low"
      >
        <ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.75} /> Helpful
      </button>
      <button
        type="button"
        onClick={() => setFeedback('not-helpful')}
        aria-pressed={feedback === 'not-helpful'}
        aria-label="Mark this investigation not helpful"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faint transition hover:bg-ink-800 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 aria-pressed:text-risk-needs"
      >
        <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} /> Not helpful
      </button>
    </>
  );
}

function UserEvidencePacket({ evidence }: { evidence: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[90%] rounded-2xl bg-ink-800 px-3.5 py-2.5 shadow-card sm:max-w-[78%]">
        <p className="max-h-28 overflow-hidden whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
          {compactEvidence(evidence)}
        </p>
      </div>
    </div>
  );
}

function RunningCard() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={1.75} />
      Checking...
    </div>
  );
}

function FollowUpMessages({ messages, loading }: { messages: ChatMessage[]; loading: boolean }) {
  if (messages.length === 0 && !loading) return null;
  return (
    <div className="space-y-2.5">
      {messages.map((message, index) => (
        <motion.div
          key={`${message.role}-${index}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
        >
          <div
            className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2.5 text-sm leading-relaxed sm:max-w-[78%] ${
              message.role === 'user'
                ? 'bg-accent text-white'
                : 'border border-line bg-ink-800 text-slate-200 shadow-card'
            }`}
          >
            {message.content}
          </div>
        </motion.div>
      ))}
      {loading && (
        <div className="flex justify-start">
          <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-ink-800 px-3 py-2 text-sm text-muted shadow-card">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.75} />
            Reviewing the report...
          </div>
        </div>
      )}
    </div>
  );
}

function sentence(value: string): string {
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function evidenceBullets(report: RiskReport, signals: StructuredSignal[]): string[] {
  const bullets = [
    ...report.positive_signals.slice(0, 2),
    ...report.red_flags.slice(0, 3),
    ...signals
      .filter((signal) => signal.category === 'positive')
      .map((signal) => signal.label)
      .slice(0, 2),
    ...report.verified_facts.slice(0, 2),
  ];
  return Array.from(new Set(bullets.map(sentence).filter(Boolean))).slice(0, 6);
}

function introParagraph(report: RiskReport, signals: StructuredSignal[]): string {
  const positives = signals.filter((signal) => signal.category === 'positive').length;
  const concerns = report.red_flags.length;
  if (report.risk_level === 'Low Risk') {
    return positives
      ? 'I checked the information you submitted and found more signs of a real opportunity than signs of fraud.'
      : 'I checked the information you submitted and did not find strong scam indicators in what was provided.';
  }
  if (report.risk_level === 'Likely Scam') {
    return 'I checked the information you submitted and found strong warning signs that match job-scam behaviour.';
  }
  if (concerns && positives) {
    return 'I checked the information you submitted and found a mix of positive and concerning signals.';
  }
  return 'I checked the information you submitted, but there is not enough clean evidence to fully verify it yet.';
}

function recommendationLead(report: RiskReport): string {
  if (report.risk_level === 'Low Risk') {
    return 'It still makes sense to continue through the employer’s official channel and avoid sharing sensitive information until the process is clearly legitimate.';
  }
  if (report.risk_level === 'Likely Scam') {
    return 'My recommendation is to stop engaging unless you can confirm the role directly through the real company’s official website or phone number.';
  }
  return 'My recommendation is to independently confirm the role through the company’s official channels before sending documents, banking details, or money.';
}

function checkedSubject(report: RiskReport): string {
  const company = report.entities.companies[0];
  const job = report.entities.job_titles[0];
  const email = report.entities.emails[0];
  const domain = report.entities.domains[0];
  const parts = [company, job, email, domain].filter(Boolean).slice(0, 4);
  return parts.length ? `Checked: ${parts.join(' · ')}` : 'Checked: the evidence you submitted';
}

interface ReferenceLink {
  title: string;
  source: string;
  url: string;
}

const TRUSTED_GUIDANCE_HOSTS = new Set([
  'consumer.ftc.gov',
  'www.ic3.gov',
  'ic3.gov',
  'www.bbb.org',
  'bbb.org',
  'www.fbi.gov',
  'fbi.gov',
]);

function safeHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function firstHttpsUrl(value: string): string | null {
  const match = value.match(/https:\/\/[^\s)]+/i);
  return match ? safeHttpsUrl(match[0]) : null;
}

function officialDomainUrl(detail: string): string | null {
  const match = detail.match(/^([a-z0-9.-]+\.[a-z]{2,})\b/i);
  if (!match) return null;
  return safeHttpsUrl(`https://${match[1].toLowerCase()}`);
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}

function trustedGuidanceUrl(value: string): string | null {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  return TRUSTED_GUIDANCE_HOSTS.has(hostLabel(url)) ? url : null;
}

function sourceReferences(result: AnalyzeResponse): ReferenceLink[] {
  const refs: ReferenceLink[] = [];
  for (const citation of result.report.guidance_citations.slice(0, 3)) {
    const url = trustedGuidanceUrl(citation.url);
    if (url) refs.push({ title: citation.title, source: citation.source, url });
  }

  for (const signal of result.signals) {
    if (signal.category !== 'positive') continue;
    const url =
      signal.id === 'official_listing'
        ? firstHttpsUrl(signal.evidence.detail)
        : signal.id === 'official_domain_match'
          ? officialDomainUrl(signal.evidence.detail)
          : null;
    if (url) refs.push({ title: signal.label, source: hostLabel(url), url });
  }

  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  }).slice(0, 5);
}

function SourceReferences({ result }: { result: AnalyzeResponse }) {
  const refs = sourceReferences(result);
  if (!refs.length) return null;
  return (
    <div className="pt-1">
      <p className="mb-1.5 text-sm font-medium text-slate-100">References</p>
      <div className="flex flex-wrap gap-2">
        {refs.map((ref) => (
          <a
            key={ref.url}
            href={ref.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-ink-850 px-2 py-1 text-xs text-muted transition hover:border-accent/50 hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate">{ref.source}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ResultGroup({ result, isLatest }: { result: AnalyzeResponse; isLatest: boolean }) {
  const { report, signals } = result;
  const bullets = evidenceBullets(report, signals);
  const tone = RISK_TONE[report.risk_level];

  return (
    <article className="max-w-[94%] space-y-3 px-1 py-1 text-sm leading-relaxed text-slate-200 sm:max-w-[82%]">
      <div>
        <h2 className={`font-display text-lg font-semibold ${tone}`}>{report.risk_level}</h2>
        <p className="mt-1 text-xs text-faint">{checkedSubject(report)}</p>
      </div>
      <p>{introParagraph(report, signals)}</p>
      <p>{sentence(report.case_summary)}</p>
      <p>{recommendationLead(report)}</p>

      {bullets.length > 0 && (
        <div className="pt-1">
          <p className="mb-1.5 text-sm font-medium text-slate-100">What influenced this</p>
          <ul className="space-y-1.5">
            {bullets.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.recommended_next_steps.length > 0 && (
        <div className="pt-1">
          <p className="mb-1.5 text-sm font-medium text-slate-100">Recommended actions</p>
          <ul className="space-y-1.5">
            {report.recommended_next_steps.slice(0, 4).map((step) => (
              <li key={step} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span>{sentence(step)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SourceReferences result={result} />

      {isLatest && (
        <div className="flex flex-wrap items-center gap-1 border-t border-line/60 pt-2">
          <VerdictActions result={result} report={report} />
        </div>
      )}
    </article>
  );
}

interface ReportAck {
  id: string;
  kind: 'report';
  company: string;
  evidence: string;
  reportId: string | null;
  reviewStatus: 'pending_review' | 'indexed' | null;
  status: 'submitting' | 'done' | 'error';
  error: string | null;
  createdAt: number;
}

function ReportAckCard({ ack }: { ack: ReportAck }) {
  if (ack.status === 'error') {
    return (
    <div role="alert" className="flex max-w-[94%] items-start gap-3 rounded-xl border border-risk-scam/40 bg-ink-850/70 px-3 py-2.5 text-sm text-risk-scam shadow-card sm:max-w-[82%]">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
        <div>
          <p className="font-medium">We could not file that report.</p>
          <p className="mt-1 text-risk-scam/90">{ack.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[94%] rounded-xl border border-line/70 bg-ink-850/70 px-3 py-2.5 text-sm text-slate-300 shadow-card sm:max-w-[82%]">
      {ack.status === 'submitting' ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent" strokeWidth={1.75} />
          Saving your report.
        </div>
      ) : (
        <div>
          <p className="font-medium text-slate-100">Report received.</p>
          <p className="mt-2 leading-relaxed">
            {ack.reviewStatus === 'indexed' ? 'I added it to the intelligence corpus' : 'I saved it for review'}
            {ack.reportId ? <span className="font-mono text-xs text-faint"> ({ack.reportId})</span> : ''}.
            Keep copies of the messages, links, payment requests, and contact details.
          </p>
        </div>
      )}
    </div>
  );
}

type TimelineItem =
  | { type: 'verify'; entry: CaseEntry; createdAt: number }
  | { type: 'report'; ack: ReportAck; createdAt: number };

export function Workspace() {
  const { entries, result, lastEvidence, loading, runAnalysis, recordReport, newCase } = useCase();
  const auth = useAuth();
  const [acks, setAcks] = useState<ReportAck[]>([]);
  const [followUps, setFollowUps] = useState<ChatMessage[]>([]);
  const [asking, setAsking] = useState(false);
  const reportAborts = useRef<Map<string, AbortController>>(new Map());
  const chatAbort = useRef<AbortController | null>(null);
  const chatInFlight = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const live = reportAborts.current;
    return () => {
      for (const controller of live.values()) controller.abort();
      live.clear();
      chatAbort.current?.abort();
    };
  }, []);

  const handleVerify = useCallback(
    (evidence: string, files: ComposerEvidenceFile[]) => {
      setFollowUps([]);
      void (async () => {
        const evidenceIds: string[] = [];
        if (auth.authenticated) {
          for (const item of files.slice(0, 8)) {
            try {
              const stored = await storeEvidence(item.file);
              evidenceIds.push(stored.evidenceId);
            } catch {
              // Evidence retention is optional. A consent/storage failure must not block the check.
            }
          }
        }
        await runAnalysis(evidence, { evidenceIds });
      })();
    },
    [auth.authenticated, runAnalysis]
  );

  const handleReport = useCallback(async (input: ReportInput) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Date.now()}`;
    const controller = new AbortController();
    const useCurrentCase =
      input.evidence.trim().length < 80 &&
      !!lastEvidence &&
      input.emails.length === 0 &&
      input.domains.length === 0 &&
      input.phones.length === 0;
    const evidence = useCurrentCase ? lastEvidence : input.evidence;
    const company =
      useCurrentCase && input.company === 'Unknown company' && result?.report.entities.companies[0]
        ? result.report.entities.companies[0]
        : input.company;
    const emails = input.emails.length
      ? input.emails
      : useCurrentCase
        ? result?.report.entities.emails.slice(0, 20) ?? []
        : [];
    const domains = input.domains.length
      ? input.domains
      : useCurrentCase
        ? result?.report.entities.domains.slice(0, 20) ?? []
        : [];
    const phones = input.phones.length
      ? input.phones
      : useCurrentCase
        ? result?.report.entities.phones.slice(0, 20) ?? []
        : [];
    reportAborts.current.set(id, controller);
    setAcks((prev) => [
      ...prev,
      {
        id,
        kind: 'report',
        company,
        evidence,
        reportId: null,
        reviewStatus: null,
        status: 'submitting',
        error: null,
        createdAt: Date.now(),
      },
    ]);
    try {
      const { reportId, status } = await submitReport(
        {
          companyName: company,
          description: evidence,
          location: input.location || undefined,
          emails,
          domains,
          phones,
        },
        { signal: controller.signal }
      );
      setAcks((prev) => prev.map((ack) => (ack.id === id ? { ...ack, status: 'done', reportId, reviewStatus: status } : ack)));
      recordReport({ company, evidence, reportId });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Could not file the report.';
      setAcks((prev) => prev.map((ack) => (ack.id === id ? { ...ack, status: 'error', error: message } : ack)));
    } finally {
      reportAborts.current.delete(id);
    }
  }, [lastEvidence, recordReport, result]);

  const handleAsk = useCallback(
    async (question: string) => {
      if (!result || chatInFlight.current) return;
      chatInFlight.current = true;
      const controller = new AbortController();
      chatAbort.current = controller;
      const ctx: CaseContext = {
        evidence: lastEvidence,
        risk_level: result.report.risk_level,
        risk_score: result.report.risk_score,
        case_summary: result.report.case_summary,
        red_flags: result.report.red_flags,
        matches: result.matches.map((match) => ({
          reportId: match.reportId,
          scamType: match.scamType,
          similarity: match.similarity,
        })),
      };
      const next = [...followUps, { role: 'user' as const, content: question.trim() }];
      setFollowUps(next);
      setAsking(true);
      try {
        const { reply } = await chat(ctx, next, { signal: controller.signal });
        setFollowUps([...next, { role: 'assistant' as const, content: reply }]);
      } catch (error) {
        if (controller.signal.aborted) return;
        setFollowUps([...next, { role: 'assistant' as const, content: detectiveFailure(error) }]);
      } finally {
        if (chatAbort.current === controller) {
          chatAbort.current = null;
          chatInFlight.current = false;
          setAsking(false);
        }
      }
    },
    [followUps, lastEvidence, result]
  );

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

  const startNew = useCallback(() => {
    for (const controller of reportAborts.current.values()) controller.abort();
    reportAborts.current.clear();
    chatAbort.current?.abort();
    chatAbort.current = null;
    chatInFlight.current = false;
    setAcks([]);
    setFollowUps([]);
    setAsking(false);
    newCase();
  }, [newCase]);

  useEffect(() => {
    function handleNewCheck() {
      startNew();
    }
    window.addEventListener('vmi:new-check', handleNewCheck);
    return () => window.removeEventListener('vmi:new-check', handleNewCheck);
  }, [startNew]);

  useEffect(() => {
    if (active && !reduceMotion) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active, asking, followUps.length, reduceMotion, timeline.length]);

  if (!active) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-2xl flex-col justify-center px-4 py-8 sm:px-6">
          <div className="mb-6 space-y-3 text-center">
            <h1 className="font-display text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              Verify a job before you trust it
            </h1>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted">
              Paste the offer, recruiter message, link, screenshot, PDF, email, or voice evidence. We check the details and tell you what is safe to do next.
            </p>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
              <span>One search</span>
              <span>Evidence-backed</span>
              <span>No forms</span>
            </div>
          </div>
          <Composer onVerify={handleVerify} onReport={handleReport} analyzing={loading} reporting={reporting} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-ink-900">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col px-4 sm:px-6">
        <div className="flex-1 py-4 sm:py-5">
          <h1 className="sr-only">Current investigation</h1>

          <div className="space-y-4">
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
                className="space-y-2.5"
              >
                {item.type === 'report' ? (
                  <>
                    <UserEvidencePacket evidence={item.ack.evidence} />
                    <ReportAckCard ack={item.ack} />
                  </>
                ) : (
                  <>
                    <UserEvidencePacket evidence={item.entry.evidence} />
                    {item.entry.status === 'running' ? (
                      <RunningCard />
                    ) : item.entry.status === 'error' ? (
                      <div role="alert" className="surface flex items-start gap-3 border-risk-scam/40 p-4 text-sm text-risk-scam">
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

          {(followUps.length > 0 || asking) && (
            <div className="mt-4">
              <FollowUpMessages messages={followUps} loading={asking} />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line/70 bg-ink-900/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <Composer
            onVerify={handleVerify}
            onReport={handleReport}
            onAsk={handleAsk}
            reporting={reporting}
            analyzing={loading}
            asking={asking}
            contextActive={!!result}
            docked
          />
        </div>
      </div>
    </div>
  );
}
