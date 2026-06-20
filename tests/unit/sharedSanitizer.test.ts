import { sanitizeSharedAnalysisResult } from '../../src/backend/local/appTools';

describe('sanitizeSharedAnalysisResult', () => {
  it('rejects arbitrary objects that are not analysis results', () => {
    expect(sanitizeSharedAnalysisResult({ hello: 'world' })).toBeNull();
  });

  it('minimizes and redacts a client-supplied shared result', () => {
    const result = sanitizeSharedAnalysisResult({
      case_id: 'case-1',
      report: {
        risk_score: 72,
        risk_level: 'Likely Scam',
        confidence: 0.83,
        case_summary: 'Asked for bank account 1234567890 before hiring.',
        entities: {
          companies: ['Acme'],
          people: ['Victim Name'],
          emails: ['recruiter@example.com'],
          domains: ['example.com'],
          urls: ['https://example.com/job'],
          phones: ['+27123456789'],
          money_requests: ['R500 training fee'],
          job_titles: ['Packer'],
        },
        verified_facts: ['Domain checked'],
        red_flags: ['Asked for bank account 1234567890'],
        positive_signals: [],
        missing_evidence: [],
        recommended_next_steps: ['Do not send money'],
        tool_results_used: ['lookup_domain_rdap'],
        guidance_citations: [{
          title: 'FTC',
          source: 'FTC',
          url: 'javascript:alert(1)',
          excerpt: 'Guidance',
          matched_signals: ['Up-front payment requested'],
        }],
      },
      trace: {
        engine_mode: 'mixed',
        stages: [{ findings: [{ evidence: 'raw private prompt text' }] }],
      },
      signals: [{
        id: 'upfront_payment_request',
        label: 'Up-front payment requested',
        category: 'red',
        points: 40,
        evidence: { source: 'text', detail: 'Bank account 1234567890 requested' },
      }],
      matches: [],
      graph: { nodes: [], edges: [], generatedAt: '2026-06-20T00:00:00.000Z' },
      multiPass: {
        status: 'escalated',
        reason: 'mixed evidence',
        outcome: 'Suspicious',
        agreement: 'medium',
        uncertainty: [],
        reviews: [{ support: ['raw'] }],
      },
      rawEvidence: 'this should never be kept',
    });

    expect(result).not.toBeNull();
    expect(result?.report.entities.people).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('Victim Name');
    expect(JSON.stringify(result)).not.toContain('1234567890');
    expect(JSON.stringify(result)).not.toContain('raw private prompt text');
    expect(JSON.stringify(result)).not.toContain('rawEvidence');
    expect(result?.trace.stages).toEqual([]);
    expect(result?.report.guidance_citations).toEqual([]);
  });
});
