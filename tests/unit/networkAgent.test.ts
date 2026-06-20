import { NetworkAgent } from '../../src/backend/agent/agents/networkAgent';
import type { NetworkAgentResult } from '../../src/backend/agent/types';
import type { GraphNode, NetworkMatch } from '../../src/backend/network/types';

function reportNode(id: string, trust: GraphNode['trust'] = 'unverified'): GraphNode {
  return {
    id: `report:${id}`,
    type: 'report',
    label: id,
    trust,
    reportCount: 1,
    firstSeen: '2026-06-20T00:00:00.000Z',
    lastSeen: '2026-06-20T00:00:00.000Z',
  };
}

function result(nodes: GraphNode[], matches: NetworkMatch[] = []): NetworkAgentResult {
  return {
    engine: 'deterministic',
    matches,
    graph: {
      nodes: [
        { ...reportNode('case-current'), id: 'report:case-current' },
        ...nodes,
      ],
      edges: [],
      generatedAt: '2026-06-20T00:00:00.000Z',
    },
    findings: [],
    summary: '',
  };
}

describe('NetworkAgent signals', () => {
  it('does not score a lone unverified structural match', () => {
    const signals = new NetworkAgent().signals(result([reportNode('R-accidental')]));

    expect(signals.map((signal) => signal.id)).not.toContain('network_infrastructure_match');
  });

  it('scores corroborated network evidence but not repeated unverified reports', () => {
    const agent = new NetworkAgent();

    const trusted = agent.signals(result([reportNode('R-trusted', 'corroborated')]));
    const repeated = agent.signals(result([reportNode('R-one'), reportNode('R-two')]));

    expect(trusted.map((signal) => signal.id)).toContain('network_infrastructure_match');
    expect(repeated.map((signal) => signal.id)).not.toContain('network_infrastructure_match');
  });

  it('does not score a lone unverified semantic match', () => {
    const match: NetworkMatch = {
      reportId: 'R-accidental',
      companyName: 'Example',
      scamType: 'job scam',
      description: 'same pasted job board listing',
      location: 'South Africa',
      reportedAt: '2026-06-20T00:00:00.000Z',
      similarity: 0.97,
      reasons: ['Very similar wording'],
      trustLevel: 'unverified',
    };

    const signals = new NetworkAgent().signals(result([], [match]));

    expect(signals.map((signal) => signal.id)).not.toContain('network_match');
  });

  it('does not score weak semantic-only matches without a hard reason', () => {
    const matches: NetworkMatch[] = [
      {
        reportId: 'R-generic-one',
        companyName: 'Example',
        scamType: 'job scam',
        description: 'generic remote job wording',
        location: 'South Africa',
        reportedAt: '2026-06-20T00:00:00.000Z',
        similarity: 0.67,
        reasons: ['Semantically similar scam wording'],
        trustLevel: 'verified',
      },
      {
        reportId: 'R-generic-two',
        companyName: 'Example',
        scamType: 'job scam',
        description: 'generic remote job wording',
        location: 'South Africa',
        reportedAt: '2026-06-20T00:00:00.000Z',
        similarity: 0.68,
        reasons: ['Semantically similar scam wording'],
        trustLevel: 'corroborated',
      },
    ];

    const signals = new NetworkAgent().signals(result([], matches));

    expect(signals.map((signal) => signal.id)).not.toContain('network_match');
  });

  it('does not treat a shared employer brand alone as a hard network match', () => {
    const match: NetworkMatch = {
      reportId: 'R-brand-only',
      companyName: 'Microsoft',
      scamType: 'brand impersonation',
      description: 'unrelated Microsoft impersonation scam',
      location: 'South Africa',
      reportedAt: '2026-06-20T00:00:00.000Z',
      similarity: 0.68,
      reasons: ['Same impersonated brand: Microsoft'],
      trustLevel: 'corroborated',
    };

    const signals = new NetworkAgent().signals(result([], [match]));

    expect(signals.map((signal) => signal.id)).not.toContain('network_match');
  });

  it('scores very strong trusted semantic-only matches', () => {
    const match: NetworkMatch = {
      reportId: 'R-strong',
      companyName: 'Example',
      scamType: 'job scam',
      description: 'very close scam wording',
      location: 'South Africa',
      reportedAt: '2026-06-20T00:00:00.000Z',
      similarity: 0.82,
      reasons: ['Semantically similar scam wording'],
      trustLevel: 'verified',
    };

    const signals = new NetworkAgent().signals(result([], [match]));

    expect(signals.map((signal) => signal.id)).toContain('network_match');
  });
});
