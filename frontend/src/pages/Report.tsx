import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, AlertTriangle, ListChecks, Cpu, Loader2 } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { useCase } from '../store/caseStore';
import { VerdictCard } from '../components/VerdictCard';
import { AgentTimeline } from '../components/AgentTimeline';
import { Findings } from '../components/Findings';
import { NetworkMatches } from '../components/NetworkMatches';
import { ChatPanel } from '../components/ChatPanel';
import { EvidenceGraph } from '../components/EvidenceGraph';
import { GuidanceCitations } from '../components/GuidanceCitations';
import type { PipelineTrace } from '../lib/types';

const STEPS = [
  'Evidence Agent: classifying input, parsing headers',
  'Verification Agent: registry, domain & pattern checks',
  'Research Agent: searching the public web',
  'Network Agent: matching the intelligence graph',
  'Critic Agent: striking unsupported claims',
  'Report Agent: composing the verdict',
];

function EngineBadge({ mode }: { mode: PipelineTrace['engine_mode'] }) {
  const map = {
    foundry: { label: 'Microsoft Foundry', cls: 'bg-accent-soft text-accent border-accent/40' },
    mixed: { label: 'Foundry + fallback', cls: 'bg-risk-needs/10 text-risk-needs border-risk-needs/40' },
    deterministic: { label: 'Deterministic engine', cls: 'bg-ink-700 text-faint border-line' },
  } as const;
  const m = map[mode];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${m.cls}`}>
      <Cpu className="h-3.5 w-3.5" />
      {m.label}
    </span>
  );
}

function Investigating() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid min-h-[340px] place-items-center">
      <div className="flex flex-col items-center gap-5 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
        <AnimatePresence mode="wait">
          <motion.p
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="font-mono text-sm text-muted"
          >
            {STEPS[step]}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 eyebrow">{children}</h3>;
}

export function Report() {
  const { result, loading, error } = useCase();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Link to="/new" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted hover:text-slate-100">
        <ArrowLeft className="h-4 w-4" /> New case
      </Link>

      {loading && (
        <div className="surface p-6">
          <Investigating />
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3 rounded-xl border border-risk-scam/40 bg-risk-scam/10 p-4 text-sm text-risk-scam">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="surface grid min-h-[280px] place-items-center p-6 text-center">
          <div>
            <p className="text-sm text-muted">No active case.</p>
            <Link to="/new" className="btn-primary mt-4">
              Start a verification
            </Link>
          </div>
        </div>
      )}

      {result && !loading && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-7">
          <div className="flex items-center justify-between">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              Investigation report
            </h1>
            <EngineBadge mode={result.trace.engine_mode} />
          </div>

          <VerdictCard report={result.report} />

          <div>
            <SectionLabel>Reasoning pipeline</SectionLabel>
            <AgentTimeline trace={result.trace} />
          </div>

          <div>
            <SectionLabel>Findings &amp; evidence</SectionLabel>
            <Findings signals={result.signals} />
          </div>

          {result.report.guidance_citations?.length > 0 && (
            <div>
              <SectionLabel>Official guidance</SectionLabel>
              <GuidanceCitations citations={result.report.guidance_citations} />
            </div>
          )}

          {result.graph && result.graph.nodes.length > 1 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <SectionLabel>Evidence graph</SectionLabel>
                <RouterLink to="/network" className="text-xs text-accent hover:text-accent-hover">
                  Explore full network →
                </RouterLink>
              </div>
              <EvidenceGraph graph={result.graph} height={400} />
              <p className="mt-2 text-xs text-faint">
                This case&#39;s identifiers connected to prior reports in the intelligence network.
                Click a node to inspect the proof.
              </p>
            </div>
          )}

          {result.matches.length > 0 && (
            <div>
              <SectionLabel>Matched in scam network</SectionLabel>
              <NetworkMatches matches={result.matches} />
            </div>
          )}

          {result.report.entities.emails.length +
            result.report.entities.domains.length +
            result.report.entities.money_requests.length >
            0 && (
            <div>
              <SectionLabel>Extracted entities</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {[
                  ...result.report.entities.emails.map((e) => ['email', e] as const),
                  ...result.report.entities.domains.map((d) => ['domain', d] as const),
                  ...result.report.entities.money_requests.map((m) => ['money', m] as const),
                  ...result.report.entities.companies.map((c) => ['company', c] as const),
                ].map(([kind, val], i) => (
                  <span
                    key={`${kind}-${i}`}
                    className="rounded-md border border-line bg-ink-800 px-2.5 py-1 font-mono text-xs text-slate-300"
                  >
                    <span className="text-faint">{kind}:</span> {val}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionLabel>
              <ListChecks className="mr-1.5 inline h-4 w-4" />
              Recommended next steps
            </SectionLabel>
            <ul className="space-y-2">
              {result.report.recommended_next_steps.map((s, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 + i * 0.06 }}
                  className="flex gap-2.5 text-sm text-slate-300"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-[11px] text-accent">
                    {i + 1}
                  </span>
                  {s}
                </motion.li>
              ))}
            </ul>
          </div>

          {result.report.missing_evidence.length > 0 && (
            <div className="surface-2 p-4">
              <p className="mb-1 text-xs font-medium text-muted">Missing evidence</p>
              <ul className="space-y-1">
                {result.report.missing_evidence.map((m, i) => (
                  <li key={i} className="text-xs text-faint">
                    — {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ChatPanel />
        </motion.div>
      )}
    </div>
  );
}
