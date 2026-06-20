// Stage 4 — Network agent (scam-intelligence network).
//
// Two complementary lookups: semantic similarity against the indexed report
// corpus (Azure AI Search vectors) and STRUCTURAL matching against the entity
// graph — does this case touch a domain, email, phone, or payment handle that
// prior reports used? Structural hits on corroborated/trusted reports carry the
// most weight; a lone unverified report never does (poisoning resistance).

import { Entities } from '../../../types/entities';
import { Finding, StructuredSignal } from '../../../types/report';
import { scamNetwork } from '../../network/scamNetwork';
import { entityGraph } from '../../network/entityGraph';
import { NetworkMatch, TrustLevel } from '../../network/types';
import { NetworkAgentResult } from '../types';

const HARD_REASON = /Shared|Same recruiter|Same payment|Same phone/;
const SEMANTIC_SIGNAL_THRESHOLD = 0.78;

const TRUST_POINTS: Record<TrustLevel, number> = {
  unverified: 6,
  verified: 14,
  corroborated: 24,
  trusted: 28,
};

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error('Network analysis aborted');
}

export class NetworkAgent {
  async run(
    evidence: string,
    entities: Entities,
    signal?: AbortSignal
  ): Promise<NetworkAgentResult> {
    // Semantic + entity matching against the indexed corpus (no-op when Azure off).
    // Engine stays 'deterministic' — vector search is computation, not LLM reasoning.
    let matches: NetworkMatch[] = [];
    if (scamNetwork.enabled) {
      throwIfAborted(signal);
      matches = await scamNetwork.search(evidence, entities, 4, signal);
    }
    throwIfAborted(signal);

    // Structural matching against the entity graph (always available).
    const graph = await entityGraph.caseSubgraph(entities, evidence);
    throwIfAborted(signal);
    const linkedReports = graph.nodes.filter(
      (n) => n.type === 'report' && n.id !== 'report:case-current'
    );
    const sharedEntities = graph.nodes.filter(
      (n) =>
        n.type !== 'report' &&
        n.type !== 'company' &&
        n.type !== 'recruiter_alias' &&
        n.reportCount >= 1 &&
        graph.edges.some((e) => e.source === 'report:case-current' && e.target === n.id)
    );

    // Enrich semantic matches with graph-computed trust.
    for (const m of matches) {
      m.trustLevel = (await entityGraph.trustOf(m.reportId)) ?? m.trustLevel;
    }

    const findings = this.findings(matches, linkedReports.length, sharedEntities.map((n) => n.label));

    const summary =
      linkedReports.length || matches.length
        ? linkedReports.length
          ? `This case shares ${sharedEntities.length} identifier${sharedEntities.length === 1 ? '' : 's'} with ${linkedReports.length} earlier scam report${linkedReports.length === 1 ? '' : 's'}${matches.length ? `, and the wording resembles ${matches.length} known report${matches.length === 1 ? '' : 's'}` : ''}.`
          : `Nothing in this case reuses known scam infrastructure, but its wording closely resembles ${matches.length} previously reported scam${matches.length === 1 ? '' : 's'}.`
        : 'Nothing in this case matches earlier reports in the intelligence network.';

    return { engine: 'deterministic', matches, graph, findings, summary };
  }

  /**
   * Trust-weighted network signals for the deterministic scorer. A structural
   * (shared-identifier) hit on corroborated/trusted reports scores highest.
   */
  signals(result: NetworkAgentResult): StructuredSignal[] {
    const signals: StructuredSignal[] = [];

    const linked = result.graph.nodes.filter(
      (n) => n.type === 'report' && n.id !== 'report:case-current'
    );
    const trustedLinked = linked.filter((n) => (n.trust ?? 'unverified') !== 'unverified');
    const linkedForSignal = trustedLinked;
    if (linkedForSignal.length) {
      const best = linkedForSignal.reduce<TrustLevel>((acc, n) => {
        const t = n.trust ?? 'unverified';
        return TRUST_POINTS[t] > TRUST_POINTS[acc] ? t : acc;
      }, 'unverified');
      signals.push({
        id: 'network_infrastructure_match',
        label: `Shares identifiers with ${linkedForSignal.length} earlier scam report${linkedForSignal.length > 1 ? 's' : ''}`,
        category: 'red',
        points: TRUST_POINTS[best],
        evidence: {
          source: 'entity_graph',
          detail: `${linkedForSignal
            .slice(0, 3)
            .map((n) => `${n.label}${n.trust ? ` [${n.trust}]` : ''}`)
            .join(', ')}${linkedForSignal.length > 3 ? ` +${linkedForSignal.length - 3} more` : ''} share this case's domains/emails/phones/payment handles`,
        },
      });
    }

    // Semantic-only matches (no structural link) are a weaker signal.
    const strongSemantic = result.matches.filter(
      (m) => m.similarity >= SEMANTIC_SIGNAL_THRESHOLD || m.reasons.some((r) => HARD_REASON.test(r))
    );
    const semanticForSignal = strongSemantic.filter(
      (m) => (m.trustLevel ?? 'unverified') !== 'unverified' || strongSemantic.length >= 2
    );
    if (!linked.length && semanticForSignal.length) {
      const top = semanticForSignal[0];
      const hard = top.reasons.some((r) => HARD_REASON.test(r));
      // Independent matches corroborate each other: scale points with the
      // match count (capped) so 4 known-scam lookalikes never read "Low Risk".
      const base = hard ? 20 : 12;
      const points = Math.min(hard ? 30 : 26, base + 4 * (semanticForSignal.length - 1));
      signals.push({
        id: 'network_match',
        label: `Resembles ${semanticForSignal.length} prior reported scam${semanticForSignal.length > 1 ? 's' : ''}`,
        category: 'red',
        points,
        evidence: {
          source: 'scam_network',
          detail: `${top.reportId} (${top.scamType}): ${top.reasons[0]}`,
        },
      });
    }

    return signals;
  }

  private findings(
    matches: NetworkMatch[],
    linkedReportCount: number,
    sharedLabels: string[]
  ): Finding[] {
    const findings: Finding[] = [];
    if (linkedReportCount) {
      findings.push({
        claim: `This case reuses identifiers from ${linkedReportCount} earlier report(s)`,
        evidence: `Shared identifiers: ${sharedLabels.slice(0, 4).join(', ')}`,
        confidence: 0.9,
        source: 'entity_graph',
      });
    }
    for (const m of matches.slice(0, 3)) {
      findings.push({
        claim: `Similar to prior report ${m.reportId} (${m.scamType})`,
        evidence: m.reasons[0] ?? 'semantic similarity',
        confidence: Math.min(0.9, 0.4 + m.similarity * 0.5),
        source: 'scam_network',
      });
    }
    if (!findings.length) {
      findings.push({
        claim: 'No prior network reports linked to this case',
        evidence: 'No shared identifiers or strong wording matches were found',
        confidence: 0.6,
        source: 'entity_graph',
      });
    }
    return findings;
  }
}
