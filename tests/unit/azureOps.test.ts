import { formatAzureDoctor, runAzureDoctor } from '../../src/backend/ops/azureDoctor';

describe('Azure operations checks', () => {
  it('validates the repo deployment surface without requiring az login', () => {
    const report = runAzureDoctor({ cwd: process.cwd(), skipAz: true });

    expect(report.ok).toBe(true);
    expect(report.checks.some((check) => check.name === 'dockerfile:healthcheck')).toBe(true);
    expect(report.checks.some((check) => check.name === 'package:online-smoke')).toBe(true);
    expect(formatAzureDoctor(report)).toContain('READY');
  });
});
