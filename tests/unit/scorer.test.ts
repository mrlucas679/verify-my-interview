// Locks the sparse-evidence behavior: resemblance to known scams must never
// be presented as "Low Risk" (user-reported recall gap, 2026-06-11).

import { DeterministicScorer, levelFromScore, scoreStructuredSignals } from '../../src/backend/scorer/deterministic_scorer';
import type { StructuredSignal } from '../../src/types/report';

function networkMatch(points: number): StructuredSignal {
  return {
    id: 'network_match',
    label: 'Resembles 4 prior reported scams',
    category: 'red',
    points,
    evidence: { source: 'scam_network', detail: 'R-1005 — semantically similar wording' },
  };
}

describe('scoreStructuredSignals — sparse-evidence floor', () => {
  it('never returns Low Risk when the case resembles known scams', () => {
    const { level } = scoreStructuredSignals([networkMatch(12)], 0.6);
    expect(level).toBe('Needs More Verification');
  });

  it('still returns Low Risk for a genuinely clean case', () => {
    const clean: StructuredSignal = {
      id: 'corporate_email',
      label: 'Corporate email domain',
      category: 'positive',
      points: -5,
      evidence: { source: 'parser', detail: 'sender on official domain' },
    };
    const { level } = scoreStructuredSignals([clean], 0.6);
    expect(level).toBe('Low Risk');
  });

  it('dampens semantic resemblance for verified-legit cases (greens, no scam mechanics)', () => {
    const greens: StructuredSignal[] = [
      {
        id: 'established_domain',
        label: 'Established domain',
        category: 'positive',
        points: -10,
        evidence: { source: 'lookup_domain_rdap', detail: 'registered 10146d ago' },
      },
      {
        id: 'mx_valid',
        label: 'Domain has valid mail records',
        category: 'positive',
        points: -5,
        evidence: { source: 'lookup_domain_rdap', detail: '1 MX record' },
      },
    ];
    const { score, level } = scoreStructuredSignals([networkMatch(24), ...greens], 0.7);
    // 24/2 + (-15) = -3 → clamped 0 → Low Risk allowed (floor waived for greens)
    expect(score).toBe(0);
    expect(level).toBe('Low Risk');
  });

  it('keeps higher bands untouched', () => {
    const { level, score } = scoreStructuredSignals(
      [networkMatch(24), networkMatch(22), networkMatch(20), networkMatch(20)],
      0.7
    );
    expect(score).toBeGreaterThan(65);
    expect(level).toBe('Likely Scam');
  });

  it('does not hide high-risk mechanics as inconclusive only because confidence is low', () => {
    expect(levelFromScore(90, 0.2)).toBe('Suspicious');
    expect(levelFromScore(0, 0.2)).toBe('Inconclusive');
  });

  it('does not label concrete scam mechanics Low Risk at the band edge', () => {
    const mechanic: StructuredSignal = {
      id: 'unofficial_application_channel',
      label: 'Application routed through an unofficial channel',
      category: 'red',
      points: 22,
      evidence: { source: 'entities', detail: 'Application uses a shortener' },
    };
    const green: StructuredSignal = {
      id: 'established_domain',
      label: 'Established domain',
      category: 'positive',
      points: -10,
      evidence: { source: 'lookup_domain_rdap', detail: 'Domain is old' },
    };

    const { score, level } = scoreStructuredSignals([mechanic, green], 0.7);
    expect(score).toBe(12);
    expect(level).toBe('Needs More Verification');
  });
});

describe('DeterministicScorer legacy adapter', () => {
  it('does not silently return zero for legacy red signals', () => {
    const result = DeterministicScorer.score({
      signals: { upfront_payment_request: true, credential_request: true },
      entities: {
        companies: [],
        people: [],
        emails: [],
        domains: [],
        urls: [],
        phones: [],
        money_requests: [],
        job_titles: [],
      },
      tool_results_used: ['detect_scam_patterns'],
      verification_coverage: 0.33,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(DeterministicScorer.explainScore({ upfront_payment_request: true })).toContain(
      'Up-front payment requested (+40)'
    );
  });
});
