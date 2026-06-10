// Six-stage investigation timeline. Replays the REAL pipeline trace —
// engines, tool calls, per-stage findings (claim + evidence + confidence +
// source) and durations come straight from the backend, staggered for
// legibility, never invented.

import { motion } from 'framer-motion';
import {
  FileSearch,
  ShieldCheck,
  Globe,
  Network,
  ScanSearch,
  FileText,
  Wrench,
  Check,
  X,
} from 'lucide-react';
import type { PipelineTrace, StageTrace, StageName } from '../lib/types';

const STAGE_META: Record<StageName, { title: string; icon: typeof FileSearch; role: string }> = {
  evidence: { title: 'Evidence Agent', icon: FileSearch, role: 'Classifies input, extracts entities & headers' },
  verification: { title: 'Verification Agent', icon: ShieldCheck, role: 'Checks registries, domains & scam patterns' },
  research: { title: 'Research Agent', icon: Globe, role: 'Finds independent evidence on the public web' },
  network: { title: 'Network Agent', icon: Network, role: 'Matches against the scam-intelligence graph' },
  critic: { title: 'Critic Agent', icon: ScanSearch, role: 'Strikes claims without tool evidence' },
  report: { title: 'Report Agent', icon: FileText, role: 'Composes the evidence-backed verdict' },
};

function EngineTag({ engine }: { engine: string }) {
  const foundry = engine === 'foundry';
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        foundry ? 'bg-accent-soft text-accent' : 'bg-ink-700 text-faint'
      }`}
    >
      {engine}
    </span>
  );
}

function FindingRow({ finding }: { finding: StageTrace['findings'][number] }) {
  return (
    <div className="rounded-md border border-line/60 bg-ink-900/60 px-2.5 py-1.5">
      <p className="text-xs text-slate-300">{finding.claim}</p>
      <p className="mt-0.5 break-words font-mono text-[10px] text-faint">
        {finding.evidence} · src {finding.source} · conf {Math.round(finding.confidence * 100)}%
      </p>
    </div>
  );
}

export function AgentTimeline({ trace }: { trace: PipelineTrace }) {
  return (
    <div className="relative">
      <div className="absolute bottom-4 left-[21px] top-4 w-px bg-gradient-to-b from-accent/40 via-line to-line" />
      <div className="space-y-2.5">
        {trace.stages.map((stage, i) => {
          const meta = STAGE_META[stage.stage] ?? {
            title: stage.stage,
            icon: FileSearch,
            role: '',
          };
          const Icon = meta.icon;
          return (
            <motion.div
              key={stage.stage}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.14, duration: 0.32 }}
              className="relative pl-[52px]"
            >
              <div className="absolute left-0 top-1 grid h-[42px] w-[42px] place-items-center rounded-xl border border-line bg-ink-800">
                <Icon className="h-[18px] w-[18px] text-accent" />
              </div>
              <div className="surface-2 p-3.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{meta.title}</span>
                  <span className="font-mono text-[10px] text-faint">
                    {stage.duration_ms >= 1000
                      ? `${(stage.duration_ms / 1000).toFixed(1)}s`
                      : `${stage.duration_ms}ms`}
                  </span>
                  <span className="ml-auto" />
                  <EngineTag engine={stage.engine} />
                </div>
                <p className="mt-0.5 text-xs text-faint">{meta.role}</p>
                <p className="mt-1.5 text-sm text-slate-300">{stage.summary}</p>

                {stage.stage === 'verification' && trace.tool_calls.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {trace.tool_calls.map((t, idx) => (
                      <motion.span
                        key={`${t.tool}-${idx}`}
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.14 + 0.18 + idx * 0.07 }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-300"
                      >
                        <Wrench className="h-3 w-3 text-faint" />
                        {t.tool}
                        {t.success ? (
                          <Check className="h-3 w-3 text-risk-low" />
                        ) : (
                          <X className="h-3 w-3 text-risk-scam" />
                        )}
                      </motion.span>
                    ))}
                  </div>
                )}

                {stage.findings.length > 0 && stage.stage !== 'report' && (
                  <div className="mt-2.5 space-y-1.5">
                    {stage.findings.slice(0, 4).map((f, idx) => (
                      <FindingRow key={idx} finding={f} />
                    ))}
                    {stage.findings.length > 4 && (
                      <p className="text-[11px] text-faint">
                        +{stage.findings.length - 4} more finding(s)
                      </p>
                    )}
                  </div>
                )}

                {stage.stage === 'critic' && (
                  <div className="mt-2">
                    {trace.critique && <p className="text-xs italic text-muted">“{trace.critique}”</p>}
                    {trace.removed_claims.map((c) => (
                      <p key={c} className="mt-1 text-[11px] text-risk-scam line-through">
                        dropped: {c}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
