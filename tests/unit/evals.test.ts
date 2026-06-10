// CI gate: every eval scenario must pass through the full pipeline in
// reproducible offline (deterministic) mode. `npm run eval` prints the same
// run as a table.

import { runEvalCases } from '../../src/backend/scripts/runEvals';

describe('investigation pipeline evals (offline mode)', () => {
  it('passes every scenario in tests/test_cases', async () => {
    const { results, allPassed } = await runEvalCases(false);

    const summary = results
      .map(
        (r) =>
          `${r.passed ? 'PASS' : 'FAIL'} ${r.file}: ${r.level} (${r.score})` +
          (r.failures.length ? ` — ${r.failures.join('; ')}` : '')
      )
      .join('\n');

    expect(results.length).toBeGreaterThanOrEqual(6);
    if (!allPassed) {
      throw new Error(`Eval failures:\n${summary}`);
    }
  });
});
