import { EvidenceAgent } from '../../src/backend/agent/agents/evidenceAgent';

describe('EvidenceAgent intake triage', () => {
  it('classifies explicit scam reports separately from ordinary checks', async () => {
    const result = await new EvidenceAgent().run(
      'I wanted to report this. The company name is Fake Identity and they contacted me on WhatsApp.'
    );

    expect(result.evidenceType).toBe('report');
    expect(result.summary).toContain('report');
  });
});
