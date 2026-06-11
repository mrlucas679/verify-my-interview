// Report writer - formats output as structured JSON

import { RiskReport, SignalSet, ScoringContext } from '../../types/report';
import { Entities } from '../../types/entities';
import { DeterministicScorer } from '../scorer/deterministic_scorer';

export class ReportWriter {
  /**
   * Generate final risk report from investigation context
   */
  static write(
    entities: Entities,
    signals: SignalSet,
    scoringContext: ScoringContext,
    verifiedFacts: string[],
    redFlags: string[],
    positiveSignals: string[],
    missingEvidence: string[]
  ): RiskReport {
    // Calculate risk score
    const { score, level, confidence } = DeterministicScorer.score(scoringContext);

    // Generate summary
    const summary = this.generateSummary(score, level, redFlags);

    // Generate recommended next steps
    const nextSteps = this.generateNextSteps(level, entities, redFlags);

    return {
      risk_score: score,
      risk_level: level,
      confidence,
      case_summary: summary,
      entities,
      verified_facts: verifiedFacts,
      red_flags: redFlags,
      positive_signals: positiveSignals,
      missing_evidence: missingEvidence,
      recommended_next_steps: nextSteps,
      tool_results_used: scoringContext.tool_results_used,
      guidance_citations: []
    };
  }

  /**
   * Generate concise case summary
   */
  private static generateSummary(score: number, level: string, redFlags: string[]): string {
    // TODO: Generate 1-3 sentence summary based on top red flags

    if (level === 'Likely Scam' && redFlags.length > 0) {
      return `Multiple red flags detected: ${redFlags.slice(0, 2).join(', ')}.`;
    } else if (level === 'Suspicious' && redFlags.length > 0) {
      return `Suspicious indicators found: ${redFlags[0]}.`;
    } else if (level === 'Low Risk') {
      return 'No significant red flags detected.';
    } else {
      return 'Insufficient evidence for risk assessment.';
    }
  }

  /**
   * Generate recommended next steps based on risk level
   */
  private static generateNextSteps(level: string, entities: Entities, _redFlags: string[]): string[] {
    const steps: string[] = [];

    if (level === 'Likely Scam' || level === 'Suspicious') {
      steps.push('Do not send money, gift cards, or cryptocurrency.');
      steps.push('Do not share personal information (SSN, banking details, passwords).');
      steps.push('Do not download or open suspicious attachments.');

      if (entities.companies && entities.companies.length > 0) {
        const company = entities.companies[0];
        steps.push(`Contact ${company} HR directly using official channels to verify the job posting.`);
      }

      if (entities.emails && entities.emails.length > 0) {
        steps.push(`Report the email address (${entities.emails[0]}) as phishing to your email provider.`);
      }

      steps.push('Search the company name + job title on official job boards (LinkedIn, Indeed, company website).');
    } else if (level === 'Needs More Verification') {
      steps.push('Request clarification on suspicious points before proceeding.');
      steps.push('Verify the job posting on the official company website or LinkedIn.');
      steps.push('Contact the company HR department directly to confirm the offer.');
    } else if (level === 'Low Risk') {
      steps.push('Proceed with normal hiring process caution.');
      steps.push('Verify job details on the official company career portal.');
    }

    if (level === 'Inconclusive') {
      steps.push('Provide more specific information (recruiter email, job posting, or communication sample).');
      steps.push('Include company name and any contact information for better verification.');
    }

    return steps;
  }
}
