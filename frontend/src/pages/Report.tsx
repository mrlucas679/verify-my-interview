import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  AlertTriangle,
  ListChecks,
  Loader2,
  Volume2,
  Square,
  Search,
  Share2,
  Check,
} from 'lucide-react';
import { useCase } from '../store/caseStore';
import { shareReport } from '../lib/api';
import type { AnalyzeResponse } from '../lib/types';
import { VerdictCard } from '../components/VerdictCard';
import { InvestigationLayers } from '../components/InvestigationLayers';
import { Findings } from '../components/Findings';
import { NetworkMatches } from '../components/NetworkMatches';
import { ChatPanel } from '../components/ChatPanel';
import { EvidenceGraph } from '../components/EvidenceGraph';
import { GuidanceCitations } from '../components/GuidanceCitations';
import type { RiskReport } from '../lib/types';
import { reportNarration } from '../lib/communication';

const STEPS = [
  'Reading the message and pulling out the names, links, and contact details',
  'Checking company, domain, phone, and payment clues',
  'Looking for public evidence that confirms or contradicts the offer',
  'Comparing identifiers with prior scam reports',
  'Reviewing the proof and writing a clear verdict',
];

// Reads the verdict + summary + top red flags aloud via the browser's
// SpeechSynthesis API. No network, no new deps; cancels on unmount/stop.
function ListenButton({ report }: { report: RiskReport }) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [speaking, setSpeaking] = useState(false);

  const buildScript = useCallback((): string => {
    return reportNarration(report);
  }, [report]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  // Stop any in-flight narration when the report changes or the page unmounts.
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  if (!supported) return null;

  function toggle() {
    if (speaking) {
      stop();
      return;
    }
    window.speechSynthesis.cancel(); // clear any queued utterance first
    const utterance = new SpeechSynthesisUtterance(buildScript());
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? 'Stop reading the report aloud' : 'Listen to the report'}
      aria-pressed={speaking}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-800 px-2.5 py-1 text-xs text-muted transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      {speaking ? (
        <>
          <Square className="h-3.5 w-3.5" strokeWidth={1.75} /> Stop audio
        </>
      ) : (
        <>
          <Volume2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Read aloud
        </>
      )}
    </button>
  );
}

// Opt-in "Share" — saves the redacted report and copies a shareable link.
// Default stays ephemeral; nothing is persisted until the user clicks this.
function ShareButton({ result }: { result: AnalyzeResponse }) {
  const [state, setState] = useState<'idle' | 'sharing' | 'copied' | 'error'>('idle');
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => { if (resetTimer.current) window.clearTimeout(resetTimer.current); }, []);

  async function share() {
    if (state === 'sharing') return;
    setState('sharing');
    try {
      const { id } = await shareReport(result);
      const link = `${window.location.origin}/s/${id}`;
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        /* clipboard may be blocked; the link still works via the address bar */
      }
      setState('copied');
    } catch {
      setState('error');
    }
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setState('idle'), 3000);
  }

  const label =
    state === 'sharing' ? 'Saving…' : state === 'copied' ? 'Link copied' : state === 'error' ? 'Unavailable' : 'Share';
  const Icon = state === 'copied' ? Check : Share2;

  return (
    <button
      type="button"
      onClick={share}
      disabled={state === 'sharing'}
      aria-label="Save and copy a shareable link to this report"
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-800 px-2.5 py-1 text-xs text-muted transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
    </button>
  );
}

function Investigating() {
  const [step, setStep] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1100);
    return () => clearInterval(t);
  }, [reduceMotion]);
  return (
    <div className="grid min-h-[340px] place-items-center">
      <div className="flex flex-col items-center gap-5 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" strokeWidth={1.75} />
        {reduceMotion ? (
            <p className="font-mono text-sm text-muted" role="status" aria-live="polite">
            Checking the evidence...
          </p>
        ) : (
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="font-mono text-sm text-muted"
            >
              {STEPS[step]}
            </motion.p>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// Slim verdict bar that fades in once the full verdict card scrolls out of
// view, so the score and risk band stay readable through the whole dossier.
const LEVEL_CLS: Record<string, string> = {
  'Likely Scam': 'text-risk-scam',
  Suspicious: 'text-risk-needs',
  'Needs More Verification': 'text-risk-needs',
  'Low Risk': 'text-risk-low',
};

function StickyVerdict({ report, visible }: { report: RiskReport; visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="fixed inset-x-0 top-0 z-40 border-b border-line bg-ink-900/90 backdrop-blur"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-2">
            <span className={`text-sm font-semibold ${LEVEL_CLS[report.risk_level] ?? 'text-muted'}`}>
              {report.risk_level}
            </span>
            <span className="font-mono text-xs text-faint">
              Risk {report.risk_score}/100 · confidence {Math.round(report.confidence * 100)}%
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 eyebrow">{label}</h2>
      {children}
    </section>
  );
}

export function Report() {
  const { result, loading, error } = useCase();
  const verdictRef = useRef<HTMLElement>(null);
  const [pastVerdict, setPastVerdict] = useState(false);

  // Show the sticky mini-verdict only after the full card leaves the viewport.
  useEffect(() => {
    const el = verdictRef.current;
    if (!el || !result) return;
    const io = new IntersectionObserver(([entry]) => setPastVerdict(!entry.isIntersecting), {
      rootMargin: '-48px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [result]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> New check
      </Link>

      {loading && (
        <div className="surface p-6">
          <Investigating />
        </div>
      )}

      {error && !loading && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-risk-scam/40 bg-risk-scam/10 p-4 text-sm text-risk-scam"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} />
          <div>
            <p className="font-medium">We couldn’t complete this verification.</p>
            <p className="mt-1 text-risk-scam/90">{error}</p>
            <Link to="/" className="btn-ghost mt-3">
              Try another check
            </Link>
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="surface grid min-h-[280px] place-items-center p-6 text-center">
          <div>
            <p className="text-sm text-muted">No active check.</p>
            <Link to="/" className="btn-primary mt-4">
              Verify a message
            </Link>
          </div>
        </div>
      )}

      {result && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="space-y-9"
        >
          {/* Sticky mini-verdict while reading the dossier */}
          <StickyVerdict report={result.report} visible={pastVerdict} />

          {/* (1) Verdict header */}
          <header ref={verdictRef}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
                What the evidence shows
              </h1>
              <div className="flex items-center gap-2.5">
                <ShareButton result={result} />
                <ListenButton report={result.report} />
              </div>
            </div>
            <VerdictCard report={result.report} />
          </header>

          {/* (2) Investigation — the centerpiece */}
          <Section label={<><Search className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.75} />Investigation</>}>
            <InvestigationLayers trace={result.trace} />
          </Section>

          {/* (3) Why this score */}
          <Section label="Why this score">
            <Findings signals={result.signals} />
          </Section>

          {/* (4) Intelligence network — only when there is a graph or matches */}
          {((result.graph && result.graph.nodes.length > 1) || result.matches.length > 0) && (
            <Section label="Intelligence network">
              {result.graph && result.graph.nodes.length > 1 && (
                <div className="mb-3">
                  <EvidenceGraph graph={result.graph} height={400} />
                  <p className="mt-2 text-xs text-faint">
                    These identifiers connect to earlier reports. Select a node to inspect the proof.
                  </p>
                </div>
              )}
              {result.matches.length > 0 && <NetworkMatches matches={result.matches} />}
            </Section>
          )}

          {/* (5) Official guidance */}
          {result.report.guidance_citations?.length > 0 && (
            <Section label="Official guidance">
              <GuidanceCitations citations={result.report.guidance_citations} />
            </Section>
          )}

          {/* (6) Recommended next steps + missing evidence */}
          {result.report.recommended_next_steps.length > 0 && (
            <Section
              label={
                <>
                  <ListChecks className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.75} />
                  Recommended next steps
                </>
              }
            >
              <ol className="space-y-2">
                {result.report.recommended_next_steps.map((s, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06 + i * 0.05, duration: 0.2, ease: 'easeOut' }}
                    className="flex gap-2.5 text-sm text-slate-300"
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] text-accent">
                      {i + 1}
                    </span>
                    {s}
                  </motion.li>
                ))}
              </ol>
            </Section>
          )}

          {result.report.missing_evidence.length > 0 && (
            <div className="surface-2 p-4">
              <p className="mb-1.5 text-xs font-medium text-muted">
                To make the verdict stronger, add
              </p>
              <ul className="space-y-1">
                {result.report.missing_evidence.map((m, i) => (
                  <li key={i} className="text-xs text-faint">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* (7) Ask the detective */}
          <ChatPanel />
        </motion.div>
      )}
    </div>
  );
}
