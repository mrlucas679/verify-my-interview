// Deterministic risk scorer

import { SignalSet, RiskLevel, ScoringContext, StructuredSignal } from '../../types/report';

/** Map a 0-100 score + confidence to a risk band. */
export function levelFromScore(score: number, confidence: number): RiskLevel {
  if (confidence < 0.3) return 'Inconclusive';
  if (score <= 15) return 'Low Risk';
  if (score <= 35) return 'Needs More Verification';
  if (score <= 65) return 'Suspicious';
  return 'Likely Scam';
}

/**
 * Transparent scoring over structured signals: the score is simply the (clamped)
 * sum of each signal's points, so every point is traceable to a piece of
 * evidence. Confidence reflects how much external verification actually ran.
 */
export function scoreStructuredSignals(
  signals: StructuredSignal[],
  toolCoverage: number
): { score: number; level: RiskLevel; confidence: number } {
  // Scam-mechanic signals: evidence of HOW the fraud operates. Semantic
  // resemblance alone is generic job language — when a case has verified
  // green signals and zero mechanics, resemblance counts at half weight so a
  // clean interview invite is not dragged up the bands by corpus similarity.
  const MECHANIC_IDS = new Set([
    'upfront_payment_request',
    'training_fee_narrative',
    'money_mule_request',
    'credential_request',
    'sms_reply_bait',
    'reply_to_mismatch',
    'dmarc_fail',
    'spf_fail',
    'lookalike_domain',
    'high_keyword_score',
    'urgency_pressure',
    'no_interview_offer',
    'network_infrastructure_match',
  ]);
  const hasMechanic = signals.some((s) => s.category === 'red' && MECHANIC_IDS.has(s.id));
  const greenTotal = signals.reduce((sum, s) => sum + Math.min(0, s.points), 0);
  const dampenSemantic = !hasMechanic && greenTotal <= -15;

  const raw = signals.reduce((sum, s) => {
    if (s.id === 'network_match' && dampenSemantic) return sum + Math.round(s.points / 2);
    return sum + s.points;
  }, 0);
  const score = Math.max(0, Math.min(100, raw));
  // Capped at 0.95: a deterministic heuristic never gets to claim certainty.
  const confidence = Math.max(
    0,
    Math.min(0.95, 0.25 + toolCoverage * 0.45 + Math.min(signals.length, 6) * 0.05)
  );
  let level = levelFromScore(score, confidence);
  // Floor rule: wording that matches the scam-intelligence network must never
  // be presented as "Low Risk" when there is nothing else to go on — sparse
  // evidence is inconclusive, not safe. When the case carries VERIFIED green
  // signals and no scam mechanics (dampenSemantic), the greens earned the
  // verdict and the floor does not apply.
  if (level === 'Low Risk' && !dampenSemantic && signals.some((s) => s.id === 'network_match')) {
    level = 'Needs More Verification';
  }
  return { score, level, confidence };
}

export class DeterministicScorer {
  /**
   * Calculate risk score based on signals
   * Returns score 0-100 and confidence 0.0-1.0
   */
  static score(context: ScoringContext): { score: number; level: RiskLevel; confidence: number } {
    const score = 0;

    // TODO: Implement scoring rules
    // Example rules (to be tuned based on evaluation):
    // - upfront_payment_request: +35 points
    // - email_domain_mismatch: +25 points
    // - recruiter_domain_age < 180 days: +20 points
    // - dns_records_weak: +15 points
    // - url_belongs_to_different_domain: +15 points
    // - company_registry_match (positive): -10 points
    // - established_domain > 5 years (positive): -5 points

    // Calculate confidence based on:
    // - tool coverage (how many tools were called)
    // - signal alignment (do signals agree?)
    // - missing evidence gaps

    const confidence = this.calculateConfidence(context);
    const level = this.scoreToLevel(score, confidence);

    return {
      score: Math.min(100, Math.max(0, score)),
      level,
      confidence
    };
  }

  /**
   * Map score to risk level
   */
  private static scoreToLevel(score: number, confidence: number): RiskLevel {
    if (confidence < 0.3) {
      return 'Inconclusive';
    }

    if (score <= 20) {
      return 'Low Risk';
    } else if (score <= 40) {
      return 'Needs More Verification';
    } else if (score <= 70) {
      return 'Suspicious';
    } else {
      return 'Likely Scam';
    }
  }

  /**
   * Calculate confidence score (0.0-1.0) based on verification coverage
   */
  private static calculateConfidence(context: ScoringContext): number {
    // Base confidence from tool coverage
    const toolCoverage = context.verification_coverage; // 0.0-1.0

    // Reduce confidence if too few tools used
    if (context.tool_results_used.length === 0) {
      return 0.1;
    }

    // Expected tool count for good coverage
    const expectedToolCount = 4; // company + domain + dns + patterns
    const toolQuality = Math.min(1.0, context.tool_results_used.length / expectedToolCount);

    // Combined confidence
    return Math.min(1.0, toolCoverage * 0.7 + toolQuality * 0.3);
  }

  /**
   * Get human-readable explanation for score
   */
  static explainScore(_signals: SignalSet): string[] {
    const explanations: string[] = [];

    // TODO: Generate explanations for each signal
    // Example:
    // if (signals.upfront_payment_request) {
    //   explanations.push("Upfront payment request detected (+35 points)");
    // }

    return explanations;
  }
}
