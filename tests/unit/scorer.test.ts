// Locks the sparse-evidence behavior: resemblance to known scams must never
// be presented as "Low Risk" (user-reported recall gap, 2026-06-11).

import { scoreStructuredSignals } from '../../src/backend/scorer/deterministic_scorer';
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

  it('keeps higher bands untouched', () => {
    const { level, score } = scoreStructuredSignals(
      [networkMatch(24), networkMatch(22), networkMatch(20), networkMatch(20)],
      0.7
    );
    expect(score).toBeGreaterThan(65);
    expect(level).toBe('Likely Scam');
  });
});
