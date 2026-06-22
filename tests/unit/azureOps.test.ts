import { formatAzureDoctor, runAzureDoctor } from '../../src/backend/ops/azureDoctor';
import fs from 'fs';
import path from 'path';

const ENV_KEYS = [
  'AZURE_AI_PROJECT_ENDPOINT',
  'AZURE_AI_MODEL_DEPLOYMENT',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'AUTH_SIGNED_IN_MONTHLY_MAX',
  'COSMOS_CONNECTION_STRING',
  'AUTH_ANON_SALT',
  'VMI_ALLOW_PUBLIC_REPORTS',
  'VMI_REPORT_API_KEY',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('Azure operations checks', () => {
  it('validates the repo deployment surface without requiring az login', () => {
    const report = runAzureDoctor({ cwd: process.cwd(), skipAz: true });

    expect(report.ok).toBe(true);
    expect(report.checks.some((check) => check.name === 'dockerfile:healthcheck')).toBe(true);
    expect(report.checks.some((check) => check.name === 'package:online-smoke')).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/azure/build-functions-package.ps1'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/azure/configure-monitoring.ps1'))).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), 'scripts/azure/configure-custom-domain.ps1'))).toBe(true);
    expect(formatAzureDoctor(report)).toContain('READY');
  });

  it('does not accept copied placeholder env values as live-ready', () => {
    process.env.AZURE_AI_PROJECT_ENDPOINT = 'https://<resource>.services.ai.azure.com/api/projects/<project>';
    process.env.AZURE_AI_MODEL_DEPLOYMENT = 'gpt-4o';
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = '<app-insights-connection-string>';
    process.env.AUTH_ISSUER = 'https://<tenant>.ciamlogin.com/<tenant-id>/v2.0';
    process.env.AUTH_AUDIENCE = '<api-client-id>,api://<api-client-id>';
    process.env.AUTH_SIGNED_IN_MONTHLY_MAX = '25';
    process.env.COSMOS_CONNECTION_STRING = '<cosmos-connection-string>';
    process.env.AUTH_ANON_SALT = '<long-random-secret>';
    process.env.VMI_ALLOW_PUBLIC_REPORTS = '1';

    const report = runAzureDoctor({ cwd: process.cwd(), skipAz: true, requireLive: true });

    expect(report.ok).toBe(false);
    expect(report.checks.some((check) => check.name === 'env:APPLICATIONINSIGHTS_CONNECTION_STRING' && check.level === 'fail')).toBe(true);
    expect(report.checks.some((check) => check.name === 'auth:configured' && check.level === 'fail')).toBe(true);
    expect(formatAzureDoctor(report)).toContain('NOT READY');
  });
});
