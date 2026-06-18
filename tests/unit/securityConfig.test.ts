// Unit tests for the fail-fast production config gate (src/backend/config/security.ts).
// These assertions are the safety net that stops a silently-insecure prod deploy,
// so the truth table must be exact: which env combinations boot, which refuse, and
// how ALLOW_INSECURE downgrades a refusal to a warning.

import {
  SecurityConfigError,
  assertSecureConfig,
  securityConfigViolations,
  securityConfigWarnings,
} from '../../src/backend/config/security';

const KEYS = [
  'NODE_ENV',
  'TRUST_PROXY',
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'COSMOS_CONNECTION_STRING',
  'AUTH_ANON_SALT',
  'APPLICATIONINSIGHTS_CONNECTION_STRING',
  'AUTH_ADMIN_EMAILS',
  'ALLOW_INSECURE',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Put the process in a fully-secure production posture. */
function secureProd(): void {
  process.env.NODE_ENV = 'production';
  process.env.TRUST_PROXY = '1';
  process.env.AUTH_ISSUER = 'https://tenant.ciamlogin.com/x/v2.0';
  process.env.AUTH_AUDIENCE = 'api-client-id';
  process.env.COSMOS_CONNECTION_STRING = 'mongodb://localhost:10255/?ssl=true';
  process.env.AUTH_ANON_SALT = 'stable-salt';
}

describe('securityConfigViolations', () => {
  it('is empty outside production (graceful degradation preserved)', () => {
    process.env.NODE_ENV = 'development';
    expect(securityConfigViolations()).toEqual([]);
  });

  it('flags missing trust-proxy and missing auth in a bare production deploy', () => {
    process.env.NODE_ENV = 'production';
    const v = securityConfigViolations();
    expect(v.some((x) => x.includes('TRUST_PROXY'))).toBe(true);
    expect(v.some((x) => x.includes('AUTH_ISSUER'))).toBe(true);
  });

  it('with auth enabled, requires a durable store and a stable anon salt', () => {
    process.env.NODE_ENV = 'production';
    process.env.TRUST_PROXY = '1';
    process.env.AUTH_ISSUER = 'https://tenant.ciamlogin.com/x/v2.0';
    process.env.AUTH_AUDIENCE = 'api-client-id';
    const v = securityConfigViolations();
    expect(v.some((x) => x.includes('COSMOS_CONNECTION_STRING'))).toBe(true);
    expect(v.some((x) => x.includes('AUTH_ANON_SALT'))).toBe(true);
    expect(v.some((x) => x.includes('TRUST_PROXY'))).toBe(false);
    expect(v.some((x) => x.includes('AUTH_ISSUER'))).toBe(false);
  });

  it('is empty when production is fully configured', () => {
    secureProd();
    expect(securityConfigViolations()).toEqual([]);
  });
});

describe('assertSecureConfig', () => {
  it('does not throw outside production', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('throws SecurityConfigError on a bare production deploy', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertSecureConfig()).toThrow(SecurityConfigError);
  });

  it('does NOT throw when ALLOW_INSECURE=1 downgrades the failure', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_INSECURE = '1';
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('does not throw when production is fully configured', () => {
    secureProd();
    expect(() => assertSecureConfig()).not.toThrow();
  });
});

describe('securityConfigWarnings', () => {
  it('warns about the break-glass email list and missing telemetry in prod', () => {
    secureProd(); // no APPLICATIONINSIGHTS_CONNECTION_STRING set
    process.env.AUTH_ADMIN_EMAILS = 'boss@example.com';
    const w = securityConfigWarnings();
    expect(w.some((x) => x.includes('AUTH_ADMIN_EMAILS'))).toBe(true);
    expect(w.some((x) => x.includes('APPLICATIONINSIGHTS'))).toBe(true);
  });

  it('is empty outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(securityConfigWarnings()).toEqual([]);
  });
});
