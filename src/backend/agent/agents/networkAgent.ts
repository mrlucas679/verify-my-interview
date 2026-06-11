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

const HARD_REASON = /Shared|Same recruiter|Same impersonated|Same payment|Same phone/;

const TRUST_POINTS: Record<TrustLevel, number> = {
  unverified: 6,
  verified: 14,
  corroborated: 24,
  trusted: 28,
};

export class NetworkAgent {
  async run(evidence: string, entities: Entities): Promise<NetworkAgentResult> {
    // Semantic + entity matching against the indexed corpus (no-op when Azure off).
    // Engine stays 'deterministic' — vector search is computation, not LLM reasoning.
    let matches: NetworkMatch[] = [];
    if (scamNetwork.enabled) {
      matches = await scamNetwork.search(evidence, entities);
    }

    // Structural matching against the entity graph (always available).
    const graph = await entityGraph.caseSubgraph(entities, evidence);
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
        ? `Linked to ${linkedReports.length} prior report(s) via ${sharedEntities.length} shared identifier(s); ${matches.length} semantic match(es).`
        : 'No prior reports share this case’s identifiers; no semantic matches.';

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
    if (linked.length) {
      const best = linked.reduce<TrustLevel>((acc, n) => {
        const t = n.trust ?? 'unverified';
        return TRUST_POINTS[t] > TRUST_POINTS[acc] ? t : acc;
      }, 'unverified');
      signals.push({
        id: 'network_infrastructure_match',
        label: `Shares infrastructure with ${linked.length} prior reported scam${linked.length > 1 ? 's' : ''}`,
        category: 'red',
        points: TRUST_POINTS[best],
        evidence: {
          source: 'entity_graph',
          detail: `${linked
            .slice(0, 3)
            .map((n) => `${n.label}${n.trust ? ` [${n.trust}]` : ''}`)
            .join(', ')}${linked.length > 3 ? ` +${linked.length - 3} more` : ''} share this case's domains/emails/phones/payment handles`,
        },
      });
    }

    // Semantic-only matches (no structural link) are a weaker signal.
    const strongSemantic = result.matches.filter(
      (m) => m.similarity >= 0.55 || m.reasons.some((r) => HARD_REASON.test(r))
    );
    if (!linked.length && strongSemantic.length) {
      const top = strongSemantic[0];
      const hard = top.reasons.some((r) => HARD_REASON.test(r));
      // Independent matches corroborate each other: scale points with the
      // match count (capped) so 4 known-scam lookalikes never read "Low Risk".
      const base = hard ? 20 : 12;
      const points = Math.min(hard ? 30 : 26, base + 4 * (strongSemantic.length - 1));
      signals.push({
        id: 'network_match',
        label: `Resembles ${strongSemantic.length} prior reported scam${strongSemantic.length > 1 ? 's' : ''}`,
        category: 'red',
        points,
        evidence: {
          source: 'scam_network',
          detail: `${top.reportId} (${top.scamType}) — ${top.reasons[0]}`,
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
        claim: `Case infrastructure appears in ${linkedReportCount} prior report(s)`,
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
        evidence: 'Entity-graph and vector search returned no shared identifiers or strong matches',
        confidence: 0.6,
        source: 'entity_graph',
      });
    }
    return findings;
  }
}
