// Composes the per-layer investigation prose for the workspace dossier.
//
// The backend emits a six-stage `PipelineTrace`; the Report collapses it into
// FIVE reader-facing layers (Critic + Report fold into "Adjudication"). Each
// layer renders ONE flowing paragraph in plain English, built from that
// stage's `summary` plus its findings' humanized text — never a key:value dump,
// never raw JSON. This module is the pure composition logic; the component just
// renders what it returns.

import type { Finding, PipelineTrace, StageName, StageTrace } from './types';

export type LayerId = 'evidence' | 'verification' | 'research' | 'network' | 'adjudication';

export interface InvestigationLayer {
  id: LayerId;
  title: string;
  role: string;
  /** Whichever backend stage drives the duration chip / engine for this layer. */
  engine: StageTrace['engine'] | null;
  /** True when a Foundry-capable stage fell back to the deterministic path. */
  fallbackReason?: string;
  durationMs: number;
  /** One flowing paragraph, <= MAX_SENTENCES sentences. */
  paragraph: string;
  /** Whether the stage actually ran (false => honest "skipped" sentence). */
  active: boolean;
  /** Structured rows for the "Evidence detail" disclosure (already bounded). */
  findings: Finding[];
  /** Adjudication only: the critic's verbatim note + any struck claims. */
  critique?: string;
  removedClaims?: string[];
}

const MAX_SENTENCES = 4;
const MAX_FINDINGS_IN_PROSE = 3;
const MAX_FINDING_ROWS = 6;

const LAYER_META: Record<LayerId, { title: string; role: string }> = {
  evidence: {
    title: 'Evidence',
    role: 'Reads the message and extracts who, what, and how they made contact.',
  },
  verification: {
    title: 'Verification',
    role: 'Checks the company, domain, phone, and message patterns where possible.',
  },
  research: {
    title: 'Research',
    role: 'Looks for public evidence that supports or contradicts the offer.',
  },
  network: {
    title: 'Similar reports',
    role: 'Checks whether earlier reports used the same links, phones, emails, or payment clues.',
  },
  adjudication: {
    title: 'Verdict review',
    role: 'Removes unsupported claims and explains the final verdict.',
  },
};

/** A finding whose evidence is raw JSON is unreadable in prose — point the
 *  reader at the disclosure instead of dumping a serialized object. */
function looksLikeJson(value: string): boolean {
  const t = value.trim();
  return t.startsWith('{') || t.startsWith('[');
}

/** Normalize one fragment into a clean, single sentence (trailing period, no
 *  doubled punctuation, bounded length so prose can't be flooded). */
function toSentence(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 240);
  if (!trimmed) return '';
  const punctuated = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return punctuated.charAt(0).toUpperCase() + punctuated.slice(1);
}

/** Turn one finding into a readable clause: prefer "claim — evidence", but
 *  drop evidence that is JSON or merely repeats the claim. */
function findingToSentence(f: Finding): string {
  const claim = f.claim?.trim() ?? '';
  const evidence = f.evidence?.trim() ?? '';
  if (!claim && !evidence) return '';
  if (!claim) {
    return looksLikeJson(evidence)
      ? 'A technical record was captured (see evidence detail).'
      : toSentence(evidence);
  }
  if (!evidence || looksLikeJson(evidence)) return toSentence(claim);
  // Avoid "X. X." when evidence just echoes the claim.
  if (evidence.toLowerCase().startsWith(claim.toLowerCase().slice(0, 24))) {
    return toSentence(claim);
  }
  return toSentence(`${claim.replace(/[.!?]$/, '')} — ${evidence}`);
}

/** Compose up to MAX_SENTENCES from a stage summary + its findings. */
function composeParagraph(summary: string, findings: Finding[]): string {
  const sentences: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const clean = s.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sentences.push(clean);
  };

  push(toSentence(summary));
  for (const f of findings.slice(0, MAX_FINDINGS_IN_PROSE)) {
    if (sentences.length >= MAX_SENTENCES) break;
    push(findingToSentence(f));
  }
  return sentences.slice(0, MAX_SENTENCES).join(' ');
}

function stageByName(trace: PipelineTrace, name: StageName): StageTrace | undefined {
  return trace.stages.find((s) => s.stage === name);
}

/** Bounded finding rows for the disclosure (caps list growth per Power-of-10). */
function rows(stage: StageTrace | undefined): Finding[] {
  return stage?.findings.slice(0, MAX_FINDING_ROWS) ?? [];
}

function honestSkip(id: LayerId): string {
  switch (id) {
    case 'research':
      return 'No public-web research was needed for this case. The submitted evidence already carried enough checkable signals.';
    case 'network':
      return 'None of this case’s identifiers matched earlier reports.';
    case 'verification':
      return 'No outside checks were run because the evidence did not include a company, domain, phone number, or contact address.';
    default:
      return 'This step produced no findings for this case.';
  }
}

/** Build the five reader-facing layers from the raw pipeline trace. */
export function buildInvestigationLayers(trace: PipelineTrace): InvestigationLayer[] {
  const evidence = stageByName(trace, 'evidence');
  const verification = stageByName(trace, 'verification');
  const research = stageByName(trace, 'research');
  const network = stageByName(trace, 'network');
  const critic = stageByName(trace, 'critic');
  const report = stageByName(trace, 'report');

  const simple = (id: Exclude<LayerId, 'adjudication'>, stage: StageTrace | undefined): InvestigationLayer => {
    const meta = LAYER_META[id];
    const active = !!stage && (stage.summary.trim().length > 0 || stage.findings.length > 0);
    const paragraph = active
      ? composeParagraph(stage!.summary, stage!.findings)
      : honestSkip(id);
    return {
      id,
      title: meta.title,
      role: meta.role,
      engine: stage?.engine ?? null,
      fallbackReason: stage?.fallback_reason,
      durationMs: stage?.duration_ms ?? 0,
      paragraph: paragraph || honestSkip(id),
      active,
      findings: rows(stage),
    };
  };

  // Adjudication folds Critic + Report: lead with the report's composed summary,
  // append the critic's note. Findings rows come from the report stage.
  const adjudicationSummary = report?.summary || critic?.summary || '';
  const adjudicationFindings = report?.findings.length ? report.findings : (critic?.findings ?? []);
  const adjActive = adjudicationSummary.trim().length > 0 || adjudicationFindings.length > 0;
  const adjudication: InvestigationLayer = {
    id: 'adjudication',
    title: LAYER_META.adjudication.title,
    role: LAYER_META.adjudication.role,
    engine: report?.engine ?? critic?.engine ?? null,
    fallbackReason: report?.fallback_reason ?? critic?.fallback_reason,
    durationMs: (critic?.duration_ms ?? 0) + (report?.duration_ms ?? 0),
    paragraph: adjActive
      ? composeParagraph(adjudicationSummary, adjudicationFindings)
      : honestSkip('adjudication'),
    active: adjActive,
    findings: rows(report).length ? rows(report) : rows(critic),
    critique: trace.critique?.trim() || undefined,
    removedClaims: trace.removed_claims.slice(0, MAX_FINDING_ROWS),
  };

  return [
    simple('evidence', evidence),
    simple('verification', verification),
    simple('research', research),
    simple('network', network),
    adjudication,
  ];
}

/** Human duration chip: "820ms" / "1.4s". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
