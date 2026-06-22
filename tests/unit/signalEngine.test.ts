import { deriveSignals } from '../../src/backend/scorer/signalEngine';
import type { AgentToolCall } from '../../src/backend/agent/types';
import type { Entities } from '../../src/types/entities';

const cleanEntities: Entities = {
  companies: ['Contoso'],
  people: [],
  emails: [],
  domains: ['careers.contoso.com'],
  urls: [],
  phones: [],
  money_requests: [],
  job_titles: [],
};

describe('deriveSignals — channel-aware domain signals', () => {
  it('does not treat a careers website without MX records as an email-domain failure', () => {
    const toolsUsed: AgentToolCall[] = [
      {
        tool: 'lookup_domain_rdap',
        input: { domain: 'careers.contoso.com' },
        result: {
          tool: 'lookup_domain_rdap',
          success: true,
          data: {
            domain: 'careers.contoso.com',
            whois_data: { age_days: 10_000 },
            dns_records: { MX: [] },
          },
        },
      },
    ];

    const signals = deriveSignals(
      'Interview with Contoso through careers.contoso.com. No payment is required.',
      cleanEntities,
      toolsUsed
    );

    expect(signals.map((signal) => signal.id)).toContain('official_domain_match');
    expect(signals.map((signal) => signal.id)).not.toContain('no_mx_records');
  });

  it('trusts email deliverability enrichment when DNS returns no MX records', () => {
    const toolsUsed: AgentToolCall[] = [
      {
        tool: 'lookup_domain_rdap',
        input: { domain: 'contoso.com', email: 'recruiter@contoso.com' },
        result: {
          tool: 'lookup_domain_rdap',
          success: true,
          data: {
            domain: 'contoso.com',
            mx_valid: true,
            whois_data: { age_days: 10_000 },
            dns_records: { MX: [] },
          },
        },
      },
    ];
    const entities: Entities = {
      ...cleanEntities,
      domains: ['contoso.com'],
      emails: ['recruiter@contoso.com'],
    };

    const signals = deriveSignals(
      'Recruiter email: recruiter@contoso.com. No payment is required.',
      entities,
      toolsUsed
    );

    expect(signals.map((signal) => signal.id)).toContain('has_mx');
    expect(signals.map((signal) => signal.id)).not.toContain('no_mx_records');
  });

  it('does not mistake a South African salary range for an up-front payment request', () => {
    const entities: Entities = {
      ...cleanEntities,
      companies: ['Perzulu (Pty) Ltd'],
      emails: ['admin@perzulu.co.za'],
      domains: ['perzulu.co.za'],
      job_titles: ['Builder/Bricklayer'],
    };

    const signals = deriveSignals(
      [
        'Perzulu (Pty) Ltd is seeking a qualified Builder (Bricklayer).',
        'Interested candidates should submit a detailed CV, certified qualifications, proof of experience, and a certified copy of their South African ID.',
        'Pay: R5 393,75 - R32 822,71 per month.',
        'Work Location: In person.',
      ].join(' '),
      entities,
      []
    );

    expect(signals.map((signal) => signal.id)).not.toContain('upfront_payment_request');
  });

  it('still flags a direct South African training-fee payment demand', () => {
    const signals = deriveSignals(
      'You must pay R850 training fee before starting the job.',
      cleanEntities,
      []
    );

    expect(signals.map((signal) => signal.id)).toContain('upfront_payment_request');
  });
});
