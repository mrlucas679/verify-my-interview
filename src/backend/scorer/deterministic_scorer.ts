// Deterministic risk scorer

import { SignalSet, RiskLevel, ScoringContext, StructuredSignal } from '../../types/report';

/** Map a 0-100 score + confidence to a risk band. */
export function levelFromScore(score: number, confidence: number): RiskLevel {
  if (confidence < 0.3) {
    if (score <= 15) return 'Inconclusive';
    if (score <= 65) return 'Needs More Verification';
    return 'Suspicious';
  }
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
    'unofficial_application_channel',
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
  if (level === 'Low Risk' && signals.some((s) => s.category === 'red' && MECHANIC_IDS.has(s.id))) {
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
    return scoreStructuredSignals(
      this.toStructuredSignals(context.signals),
      context.verification_coverage
    );
  }

  /**
   * Get human-readable explanation for score
   */
  static explainScore(signals: SignalSet): string[] {
    return this.toStructuredSignals(signals).map((s) => `${s.label} (${s.points > 0 ? '+' : ''}${s.points})`);
  }

  private static toStructuredSignals(signals: SignalSet): StructuredSignal[] {
    const out: StructuredSignal[] = [];
    if (signals.upfront_payment_request) {
      out.push({
        id: 'upfront_payment_request',
        label: 'Up-front payment requested',
        category: 'red',
        points: 40,
        evidence: { source: 'legacy_signal_set', detail: 'Legacy signal set marked upfront payment request' },
      });
    }
    if (signals.email_domain_mismatch) {
      out.push({
        id: 'email_domain_mismatch',
        label: 'Recruiter email/domain mismatch',
        category: 'red',
        points: 22,
        evidence: { source: 'legacy_signal_set', detail: 'Legacy signal set marked email/domain mismatch' },
      });
    }
    if (signals.dns_records_weak) {
      out.push({
        id: 'dns_records_weak',
        label: 'Weak or missing domain records',
        category: 'red',
        points: 12,
        evidence: { source: 'legacy_signal_set', detail: 'Legacy signal set marked weak DNS records' },
      });
    }
    if (signals.url_belongs_to_different_domain) {
      out.push({
        id: 'url_belongs_to_different_domain',
        label: 'Application URL uses a different domain',
        category: 'red',
        points: 15,
        evidence: { source: 'legacy_signal_set', detail: 'Legacy signal set marked off-domain URL' },
      });
    }
    const registry = signals.company_registry_match;
    if (registry) {
      out.push({
        id: registry.present ? 'company_registered' : 'company_not_in_registry',
        label: registry.present ? 'Company registered' : 'Company not found in registry',
        category: registry.present ? 'positive' : 'red',
        points: registry.present ? -15 : 12,
        evidence: { source: 'legacy_signal_set', detail: 'Legacy signal set included company registry status' },
      });
    }
    const age = signals.recruiter_domain_age;
    if (age) {
      const young = age.red_flag || age.days < 180;
      out.push({
        id: young ? 'new_recruiter_domain' : 'established_domain',
        label: young ? `Recruiter domain only ${age.days} days old` : 'Established recruiter domain',
        category: young ? 'red' : 'positive',
        points: young ? (age.days < 90 ? 20 : 10) : -10,
        evidence: { source: 'legacy_signal_set', detail: `Legacy signal set reported domain age ${age.days} days` },
      });
    }
    return out;
  }
}
