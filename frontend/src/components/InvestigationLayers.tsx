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
import { proofSourceLabel, stageEngineLabel, toolLabel } from '../lib/communication';

const LAYER_ICON: Record<LayerId, LucideIcon> = {
  evidence: FileSearch,
  verification: ShieldCheck,
  research: Globe,
  network: Network,
  adjudication: Gavel,
};

function EngineTag({ layer }: { layer: InvestigationLayer }) {
  const foundry = layer.engine === 'foundry' && !layer.fallbackReason;
  const fallback = Boolean(layer.fallbackReason);
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        fallback
          ? 'bg-risk-needs/10 text-risk-needs'
          : foundry
            ? 'bg-accent-soft text-accent'
            : 'bg-ink-700 text-faint'
      }`}
    >
      {stageEngineLabel(layer)}
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
          Proof: {proofSourceLabel(finding.source)}
        </span>
        <span className="font-mono text-[10px] text-faint">
          certainty {Math.round(finding.confidence * 100)}%
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
          {toolLabel(t.tool)}
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
        View checked proof
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
              Claims removed because proof was missing
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
}: {
  layer: InvestigationLayer;
  trace: PipelineTrace;
  index: number;
}) {
  const reduceMotion = useReducedMotion();
  const Icon = LAYER_ICON[layer.id];

  // The dossier effect: each layer card overlaps the one before it, so the
  // investigation literally reads as evidence stacked into a verdict.
  return (
    <motion.article
      {...(reduceMotion
        ? {}
        : {
            initial: { opacity: 0, y: 18 },
            whileInView: { opacity: 1, y: 0 },
            viewport: { once: true, margin: '-40px' },
            transition: { duration: 0.26, ease: 'easeOut' as const },
          })}
      style={{ zIndex: index + 1 }}
      className={`surface relative p-4 transition-transform duration-200 ease-out hover:-translate-y-0.5 sm:p-5 ${
        index > 0 ? '-mt-3' : ''
      } ${layer.active ? '' : 'opacity-90'}`}
    >
      {/* Layer index tab — the "page number" of the dossier */}
      <span
        aria-hidden="true"
        className="absolute right-4 top-4 font-mono text-[10px] uppercase tracking-[0.16em] text-faint"
      >
        Layer {String(index + 1).padStart(2, '0')}
      </span>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pr-16">
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 place-items-center rounded-lg border ${
            layer.active ? 'border-accent/50 bg-ink-900 text-accent' : 'border-line bg-ink-900 text-faint'
          }`}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <h3 className="font-display text-base font-semibold text-slate-100">{layer.title}</h3>
        {layer.durationMs > 0 && (
          <span className="font-mono text-[10px] text-faint">{formatDuration(layer.durationMs)}</span>
        )}
        {layer.engine && <EngineTag layer={layer} />}
      </div>
      <p className="mt-1 text-xs text-faint">{layer.role}</p>

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
    </motion.article>
  );
}

export function InvestigationLayers({ trace }: { trace: PipelineTrace }) {
  const layers = buildInvestigationLayers(trace);
  return (
    <div className="relative">
      {layers.map((layer, i) => (
        <LayerBlock key={layer.id} layer={layer} trace={trace} index={i} />
      ))}
    </div>
  );
}
