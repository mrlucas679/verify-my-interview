import { runMultiPassAdjudication } from '../../src/backend/agent/multiPass';
import type { EntityGraph } from '../../src/backend/network/types';
import type { RiskReport, StructuredSignal } from '../../src/types/report';
import type { Entities } from '../../src/types/entities';

const emptyEntities: Entities = {
  companies: [],
  people: [],
  emails: [],
  domains: [],
  urls: [],
  phones: [],
  money_requests: [],
  job_titles: [],
};

const emptyGraph: EntityGraph = { nodes: [], edges: [], generatedAt: '2026-06-12T00:00:00.000Z' };

function signal(id: string, category: 'red' | 'positive', points: number): StructuredSignal {
  return {
    id,
    label: id.replace(/_/g, ' '),
    category,
    points,
    evidence: { source: category === 'red' ? 'text' : 'lookup_domain_rdap', detail: `${id} detail` },
  };
}

function report(overrides: Partial<RiskReport>): RiskReport {
  return {
    risk_score: 0,
    risk_level: 'Low Risk',
    confidence: 0.9,
    case_summary: '',
    entities: emptyEntities,
    verified_facts: [],
    red_flags: [],
    positive_signals: [],
    missing_evidence: [],
    recommended_next_steps: [],
    tool_results_used: [],
    guidance_citations: [],
    ...overrides,
  };
}

describe('runMultiPassAdjudication', () => {
  it('does not escalate when first-pass evidence is already decisive', () => {
    const result = runMultiPassAdjudication({
      report: report({ risk_level: 'Likely Scam', risk_score: 90, confidence: 0.9 }),
      signals: [signal('upfront_payment_request', 'red', 40), signal('credential_request', 'red', 25)],
      matches: [],
      graph: emptyGraph,
      removedClaims: [],
      evidenceType: 'email',
    });

    expect(result.status).toBe('single_pass_sufficient');
    expect(result.outcome).toBe('High Risk Scam Indicators');
  });

  it('escalates mixed evidence into review passes', () => {
    const result = runMultiPassAdjudication({
      report: report({ risk_level: 'Needs More Verification', risk_score: 25, confidence: 0.62 }),
      signals: [signal('upfront_payment_request', 'red', 40), signal('established_domain', 'positive', -10)],
      matches: [],
      graph: emptyGraph,
      removedClaims: [],
      evidenceType: 'text',
    });

    expect(result.status).toBe('escalated');
    expect(result.reviews.map((r) => r.pass)).toEqual([
      'base_pipeline',
      'blind_verification',
      'skeptic_red_team',
    ]);
    expect(result.outcome).toBe('Requires Human Review');
  });

  it('treats empty evidence as insufficient rather than reassuring', () => {
    const result = runMultiPassAdjudication({
      report: report({ risk_level: 'Inconclusive', risk_score: 0, confidence: 0.3 }),
      signals: [],
      matches: [],
      graph: emptyGraph,
      removedClaims: [],
      evidenceType: 'text',
    });

    expect(result.status).toBe('escalated');
    expect(result.outcome).toBe('Insufficient Evidence');
  });
});
