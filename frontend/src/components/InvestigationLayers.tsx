// The investigation centerpiece: one vertically stacked layer per agent
// (Evidence, Verification, Research, Network, Adjudication). Each layer reads
// as ONE plain-English paragraph composed by `buildInvestigationLayers`, with a
// connected timeline rail, a duration chip, the engine that ran it, and a
// collapsed "Evidence detail" disclosure exposing the structured proof rows.
//
// Prose is composed defensively upstream (capped sentences, no raw JSON); this
// component only renders. No `dangerouslySetInnerHTML` — React escapes text.

import { motion, useReducedMotion } from 'framer-motion';
import {
  FileSearch,
  ShieldCheck,
  Globe,
  Network,
  Gavel,
  Wrench,
  Check,
  X,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { Finding, PipelineTrace } from '../lib/types';
import {
  buildInvestigationLayers,
  formatDuration,
  type InvestigationLayer,
  type LayerId,
} from '../lib/investigation';

const LAYER_ICON: Record<LayerId, LucideIcon> = {
  evidence: FileSearch,
  verification: ShieldCheck,
  research: Globe,
  network: Network,
  adjudication: Gavel,
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

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="rounded-md border border-line/60 bg-ink-900/70 px-2.5 py-2">
      <p className="text-xs leading-relaxed text-slate-300">{finding.claim}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="break-all font-mono text-[10px] text-faint">{finding.evidence}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-faint">
          src {finding.source}
        </span>
        <span className="font-mono text-[10px] text-faint">
          conf {Math.round(finding.confidence * 100)}%
        </span>
      </div>
    </li>
  );
}

function ToolChips({ trace }: { trace: PipelineTrace }) {
  if (trace.tool_calls.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {trace.tool_calls.slice(0, 12).map((t, idx) => (
        <span
          key={`${t.tool}-${idx}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-900 px-2 py-1 font-mono text-[11px] text-slate-300"
        >
          <Wrench className="h-3 w-3 text-faint" strokeWidth={1.75} />
          {t.tool}
          {t.success ? (
            <Check className="h-3 w-3 text-risk-low" strokeWidth={2} />
          ) : (
            <X className="h-3 w-3 text-risk-scam" strokeWidth={2} />
          )}
        </span>
      ))}
    </div>
  );
}

function EvidenceDetail({
  layer,
  trace,
}: {
  layer: InvestigationLayer;
  trace: PipelineTrace;
}) {
  const hasRows = layer.findings.length > 0;
  const hasStruck = layer.id === 'adjudication' && (layer.removedClaims?.length ?? 0) > 0;
  const hasTools = layer.id === 'verification' && trace.tool_calls.length > 0;
  if (!hasRows && !hasStruck && !hasTools) return null;

  return (
    <details className="group mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-xs text-muted transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <ChevronRight
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          strokeWidth={1.75}
        />
        Evidence detail
      </summary>
      <div className="mt-2.5 space-y-2.5 border-l border-line/70 pl-3">
        {hasTools && <ToolChips trace={trace} />}

        {hasRows && (
          <ul className="space-y-1.5">
            {layer.findings.map((f, idx) => (
              <FindingRow key={idx} finding={f} />
            ))}
          </ul>
        )}

        {hasStruck && (
          <div className="space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
              Claims struck for lack of evidence
            </p>
            {layer.removedClaims!.map((c) => (
              <p key={c} className="text-[11px] text-risk-scam line-through">
                {c}
              </p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function LayerBlock({
  layer,
  trace,
  index,
  isLast,
}: {
  layer: InvestigationLayer;
  trace: PipelineTrace;
  index: number;
  isLast: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const Icon = LAYER_ICON[layer.id];
  const dotColor = layer.active ? 'border-accent bg-ink-850' : 'border-line bg-ink-850';

  return (
    <motion.div
      {...(reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.22, ease: 'easeOut' as const, delay: index * 0.06 },
          })}
      className="relative pl-12"
    >
      {/* Connected rail: line down from this dot to the next layer */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[15px] top-8 bottom-[-18px] w-px bg-line"
        />
      )}
      {/* Dot */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1 grid h-8 w-8 place-items-center rounded-full border ${dotColor}`}
      >
        <Icon
          className={layer.active ? 'h-4 w-4 text-accent' : 'h-4 w-4 text-faint'}
          strokeWidth={1.75}
        />
      </span>

      <div className="pb-5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="font-display text-base font-semibold text-slate-100">{layer.title}</h3>
          {layer.durationMs > 0 && (
            <span className="font-mono text-[10px] text-faint">{formatDuration(layer.durationMs)}</span>
          )}
          {layer.engine && <EngineTag engine={layer.engine} />}
        </div>
        <p className="mt-0.5 text-xs text-faint">{layer.role}</p>

        <p
          className={`mt-2.5 text-sm leading-relaxed ${
            layer.active ? 'text-slate-200' : 'italic text-muted'
          }`}
        >
          {layer.paragraph}
        </p>

        {/* Adjudication: surface the critic's verbatim note inline */}
        {layer.id === 'adjudication' && layer.critique && (
          <p className="mt-2 border-l-2 border-line pl-3 text-xs italic text-muted">
            “{layer.critique}”
          </p>
        )}

        <EvidenceDetail layer={layer} trace={trace} />
      </div>
    </motion.div>
  );
}

export function InvestigationLayers({ trace }: { trace: PipelineTrace }) {
  const layers = buildInvestigationLayers(trace);
  return (
    <div className="surface p-5">
      {layers.map((layer, i) => (
        <LayerBlock
          key={layer.id}
          layer={layer}
          trace={trace}
          index={i}
          isLast={i === layers.length - 1}
        />
      ))}
    </div>
  );
}
