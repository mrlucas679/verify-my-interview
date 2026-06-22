import { azureMonitorConfigured } from '../../src/backend/observability/telemetry';

const KEYS = ['NODE_ENV', 'APPLICATIONINSIGHTS_CONNECTION_STRING', 'VMI_TELEMETRY_DISABLED'] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.NODE_ENV = 'development';
  delete process.env.VMI_TELEMETRY_DISABLED;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('Azure Monitor telemetry config', () => {
  it('rejects placeholder connection strings', () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = '<app-insights-connection-string>';
    expect(azureMonitorConfigured()).toBe(false);
  });

  it('accepts a real-looking Application Insights connection string', () => {
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING =
      'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.applicationinsights.azure.com/';
    expect(azureMonitorConfigured()).toBe(true);
  });
});
