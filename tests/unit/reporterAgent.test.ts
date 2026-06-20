import { ReporterAgent } from '../../src/backend/agent/agents/reporterAgent';
import type { ReporterInput } from '../../src/backend/agent/agents/reporterAgent';

const baseInput: ReporterInput = {
  riskLevel: 'Likely Scam',
  riskScore: 80,
  evidenceType: 'text',
  entities: {
    companies: ['Acme'],
    people: [],
    emails: ['recruiter@example.com'],
    domains: ['example.com'],
    urls: [],
    phones: [],
    money_requests: ['R500 training fee'],
    job_titles: [],
  },
  signals: {
    verified_facts: [],
    red_flags: ['Up-front payment requested'],
    positive_signals: [],
  },
};

describe('ReporterAgent narrative validation', () => {
  it('falls back when Foundry contradicts the computed risk and advises unsafe action', async () => {
    const runner = {
      runTurn: jest.fn().mockResolvedValue({
        finalText: JSON.stringify({
          case_summary: 'This is definitely safe to proceed and fully verified.',
          recommended_next_steps: ['Send the money to the recruiter now.'],
        }),
      }),
    };

    const result = await new ReporterAgent(runner as never).run(baseInput);

    expect(result.engine).toBe('deterministic');
    expect(result.fallback_reason).toMatch(/safety validation/i);
    expect(result.case_summary.toLowerCase()).toContain('strong signs of a job scam');
    expect(result.recommended_next_steps.join(' ').toLowerCase()).toContain('do not send money');
  });

  it('keeps a safe Foundry narrative', async () => {
    const runner = {
      runTurn: jest.fn().mockResolvedValue({
        finalText: JSON.stringify({
          case_summary: 'This has serious warning signs because payment is requested before hiring. Stop until the company confirms the role through official channels.',
          recommended_next_steps: ['Do not send money.', 'Contact the company through its official website.'],
        }),
      }),
    };

    const result = await new ReporterAgent(runner as never).run(baseInput);

    expect(result.engine).toBe('foundry');
    expect(result.fallback_reason).toBeUndefined();
  });
});
