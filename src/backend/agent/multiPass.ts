import { EntityGraph, NetworkMatch } from '../network/types';
import { RiskReport, StructuredSignal } from '../../types/report';

export type MultiPassStatus = 'single_pass_sufficient' | 'escalated';
export type MultiPassOutcome =
  | 'Verified Legitimate'
  | 'Likely Legitimate'
  | 'Insufficient Evidence'
  | 'Requires Human Review'
  | 'Suspicious'
  | 'High Risk Scam Indicators';

export interface MultiPassReview {
  pass: 'base_pipeline' | 'blind_verification' | 'skeptic_red_team';
  conclusion: string;
  support: string[];
  challenges: string[];
}

export interface MultiPassResult {
  status: MultiPassStatus;
  reason: string;
  outcome: MultiPassOutcome;
  agreement: 'high' | 'medium' | 'low';
  uncertainty: string[];
  reviews: MultiPassReview[];
}

interface MultiPassInput {
  report: RiskReport;
  signals: StructuredSignal[];
  matches: NetworkMatch[];
  graph: EntityGraph;
  removedClaims: string[];
  evidenceType: string;
}

const MECHANIC_SIGNALS = new Set([
  'upfront_payment_request',
  'credential_request',
  'training_fee_narrative',
  'money_mule_request',
  'reply_to_mismatch',
  'dmarc_fail',
  'spf_fail',
  'network_infrastructure_match',
]);

function redSignals(signals: StructuredSignal[]): StructuredSignal[] {
  return signals.filter((s) => s.category === 'red');
}

function positiveSignals(signals: StructuredSignal[]): StructuredSignal[] {
  return signals.filter((s) => s.category === 'positive');
}

function graphLinkedReportCount(graph: EntityGraph): number {
  return graph.nodes.filter((n) => n.type === 'report' && n.id !== 'report:case-current').length;
}

function hasScamMechanic(signals: StructuredSignal[]): boolean {
  return signals.some((s) => s.category === 'red' && MECHANIC_SIGNALS.has(s.id));
}

function escalationReason(input: MultiPassInput): string | null {
  const reds = redSignals(input.signals);
  const greens = positiveSignals(input.signals);
  const level = input.report.risk_level;

  if (input.signals.length === 0) return 'No structured signal was available to adjudicate.';
  if (input.removedClaims.length > 0) return 'The critic removed unsupported claims.';
  if (reds.length > 0 && greens.length > 0) return 'The case has both risk and reassuring evidence.';
  if (input.report.confidence < 0.7) return 'Confidence is below the product-ready threshold.';
  if (level === 'Needs More Verification' || level === 'Suspicious') {
    return 'The first pass produced an intermediate-risk outcome.';
  }
  if (input.evidenceType === 'report' && reds.length > 0 && input.report.confidence < 0.85) {
    return 'User submitted this as a scam report with unresolved uncertainty.';
  }
  return null;
}

function outcomeFor(input: MultiPassInput): MultiPassOutcome {
  const reds = redSignals(input.signals);
  const greens = positiveSignals(input.signals);
  const linkedReports = graphLinkedReportCount(input.graph);
  const mechanic = hasScamMechanic(input.signals);
  const level = input.report.risk_level;

  if (input.signals.length === 0 || (level === 'Inconclusive' && input.report.risk_score <= 15)) {
    return 'Insufficient Evidence';
  }
  if (input.report.risk_score >= 70 && (mechanic || linkedReports > 0)) {
    return 'High Risk Scam Indicators';
  }
  if (level === 'Likely Scam' && (mechanic || linkedReports > 0)) return 'High Risk Scam Indicators';
  if (level === 'Suspicious') return input.report.confidence < 0.55 ? 'Requires Human Review' : 'Suspicious';
  if (level === 'Needs More Verification') {
    return reds.some((s) => MECHANIC_SIGNALS.has(s.id)) ? 'Requires Human Review' : 'Insufficient Evidence';
  }
  if (level === 'Low Risk' && reds.length === 0 && greens.length >= 2 && input.report.confidence >= 0.9) {
    return 'Verified Legitimate';
  }
  if (level === 'Low Risk') return 'Likely Legitimate';
  return 'Requires Human Review';
}

function agreementFor(input: MultiPassInput, outcome: MultiPassOutcome): MultiPassResult['agreement'] {
  const reds = redSignals(input.signals).length;
  const greens = positiveSignals(input.signals).length;
  if (input.removedClaims.length > 0 || (reds > 0 && greens > 0)) return 'low';
  if (outcome === 'Requires Human Review' || input.report.confidence < 0.75) return 'medium';
  return 'high';
}

function uncertaintyFor(input: MultiPassInput): string[] {
  const out: string[] = [];
  if (input.report.missing_evidence.length) out.push(...input.report.missing_evidence.slice(0, 3));
  if (input.matches.length && graphLinkedReportCount(input.graph) === 0) {
    out.push('Network resemblance is semantic only; no shared hard identifier was found.');
  }
  if (input.removedClaims.length) {
    out.push(`${input.removedClaims.length} unsupported claim(s) were removed before scoring.`);
  }
  if (input.report.confidence < 0.7) out.push('Confidence is limited by weak or conflicting evidence.');
  return Array.from(new Set(out)).slice(0, 5);
}

function baseReview(input: MultiPassInput): MultiPassReview {
  return {
    pass: 'base_pipeline',
    conclusion: `${input.report.risk_level} at ${input.report.risk_score}/100 from ${input.signals.length} structured signal(s).`,
    support: input.signals.slice(0, 5).map((s) => `${s.label}: ${s.evidence.detail}`),
    challenges: input.report.missing_evidence.slice(0, 3),
  };
}

function blindVerification(input: MultiPassInput): MultiPassReview {
  const reds = redSignals(input.signals);
  const greens = positiveSignals(input.signals);
  return {
    pass: 'blind_verification',
    conclusion: `${reds.length} risk signal(s) and ${greens.length} reassuring signal(s) were independently checked from structured evidence only.`,
    support: reds
      .filter((s) => s.evidence.source !== 'text')
      .slice(0, 4)
      .map((s) => `${s.label} via ${s.evidence.source}`),
    challenges: greens.slice(0, 4).map((s) => `Reassuring counter-signal: ${s.label}`),
  };
}

function skepticReview(input: MultiPassInput): MultiPassReview {
  const challenges = uncertaintyFor(input);
  const falsePositiveRisk =
    redSignals(input.signals).length > 0 && positiveSignals(input.signals).length > 0
      ? 'Legitimate-company evidence may coexist with a fake recruiter channel.'
      : 'No strong false-positive conflict found.';
  return {
    pass: 'skeptic_red_team',
    conclusion: falsePositiveRisk,
    support: input.signals
      .filter((s) => s.category === 'red' && MECHANIC_SIGNALS.has(s.id))
      .slice(0, 4)
      .map((s) => `Hard scam mechanic: ${s.label}`),
    challenges,
  };
}

export function runMultiPassAdjudication(input: MultiPassInput): MultiPassResult {
  const reason = escalationReason(input);
  const outcome = outcomeFor(input);
  const agreement = agreementFor(input, outcome);
  const base = baseReview(input);

  if (!reason) {
    return {
      status: 'single_pass_sufficient',
      reason: 'First-pass evidence was strong enough; extra passes would not change the outcome.',
      outcome,
      agreement,
      uncertainty: uncertaintyFor(input),
      reviews: [base],
    };
  }

  return {
    status: 'escalated',
    reason,
    outcome,
    agreement,
    uncertainty: uncertaintyFor(input),
    reviews: [base, blindVerification(input), skepticReview(input)],
  };
}
