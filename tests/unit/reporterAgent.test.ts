import { ReporterAgent } from '../../src/backend/agent/agents/reporterAgent';

describe('ReporterAgent report-intake guidance', () => {
  it('adds evidence-preservation steps for scam reports', async () => {
    const result = await new ReporterAgent(null).run({
      signals: {
        verified_facts: [],
        red_flags: ['Money asked for training / registration'],
        positive_signals: [],
      },
      riskLevel: 'Needs More Verification',
      riskScore: 30,
      entities: {
        companies: ['Fake Identity'],
        people: [],
        emails: [],
        domains: [],
        urls: [],
        phones: ['060 000 0000'],
        money_requests: [],
        job_titles: [],
      },
      evidenceType: 'report',
    });

    expect(result.case_summary).toContain('scam report');
    expect(result.recommended_next_steps.join(' ')).toContain('Preserve screenshots');
  });
});
