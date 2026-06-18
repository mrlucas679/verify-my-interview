// Unit tests for the access-control DECISION path (src/backend/auth/middleware.ts):
// the free-tier gate, the anonymous-trial limit, usage metering bypass, and the
// authZ guards. These are security-critical branches — a wrong decision means
// either a locked-out legitimate user or unauthorized access.
//
// No network/DB mocks are needed: every branch is driven purely by env + the
// request shape. We keep Cosmos disabled (COSMOS_CONNECTION_STRING unset) so the
// anonymous gate uses its in-memory fallback and metering is a no-op.

import type { Response } from 'express';
import {
  AuthedRequest,
  attachIdentity,
  enforceAnalyzeAccess,
  requireAdmin,
  requireAuth,
} from '../../src/backend/auth/middleware';

const ENV_KEYS = [
  'AUTH_ISSUER',
  'AUTH_AUDIENCE',
  'AUTH_ANON_TRIAL_MAX',
  'COSMOS_CONNECTION_STRING',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function enableAuth(): void {
  process.env.AUTH_ISSUER = 'https://tenant.ciamlogin.com/x/v2.0';
  process.env.AUTH_AUDIENCE = 'api-client-id';
}

interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

function mockRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function mockReq(opts: { ip?: string; identity?: AuthedRequest['identity']; auth?: string } = {}): AuthedRequest {
  return {
    ip: opts.ip ?? '198.51.100.1',
    identity: opts.identity,
    get: (h: string) => (h.toLowerCase() === 'authorization' ? opts.auth : undefined),
  } as unknown as AuthedRequest;
}

describe('attachIdentity', () => {
  it('is a no-op pass-through when auth is unconfigured', async () => {
    const req = mockReq();
    const next = jest.fn();
    await attachIdentity(req, mockRes() as unknown as Response, next);
    expect(req.identity).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows an anonymous request (no token) through when auth is enabled', async () => {
    enableAuth();
    const req = mockReq();
    const next = jest.fn();
    await attachIdentity(req, mockRes() as unknown as Response, next);
    expect(req.identity).toBeNull();
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('enforceAnalyzeAccess', () => {
  it('does not gate when auth is unconfigured (stays fully open)', async () => {
    const req = mockReq();
    const next = jest.fn();
    const res = mockRes();
    await enforceAnalyzeAccess(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('always allows a signed-in user (unlimited, metered-not-capped)', async () => {
    enableAuth();
    const req = mockReq({ identity: { userId: 'u-1', roles: [] } });
    const next = jest.fn();
    await enforceAnalyzeAccess(req, mockRes() as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows the first anonymous trial then blocks the second with 401', async () => {
    enableAuth();
    process.env.AUTH_ANON_TRIAL_MAX = '1';
    const ip = '203.0.113.77'; // unique IP so the module-level counter is isolated
    const next1 = jest.fn();
    await enforceAnalyzeAccess(mockReq({ ip }), mockRes() as unknown as Response, next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const next2 = jest.fn();
    const res2 = mockRes();
    await enforceAnalyzeAccess(mockReq({ ip }), res2 as unknown as Response, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.statusCode).toBe(401);
    expect((res2.body as { code?: string }).code).toBe('trial_exhausted');
  });

  it('requires sign-in immediately when AUTH_ANON_TRIAL_MAX is 0', async () => {
    enableAuth();
    process.env.AUTH_ANON_TRIAL_MAX = '0';
    const next = jest.fn();
    const res = mockRes();
    await enforceAnalyzeAccess(mockReq({ ip: '203.0.113.99' }), res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect((res.body as { code?: string }).code).toBe('auth_required');
  });
});

describe('requireAuth', () => {
  it('503 when auth is unconfigured', () => {
    const res = mockRes();
    requireAuth(mockReq(), res as unknown as Response, jest.fn());
    expect(res.statusCode).toBe(503);
  });

  it('401 when signed out, passes when signed in', () => {
    enableAuth();
    const resAnon = mockRes();
    requireAuth(mockReq(), resAnon as unknown as Response, jest.fn());
    expect(resAnon.statusCode).toBe(401);

    const next = jest.fn();
    requireAuth(mockReq({ identity: { userId: 'u-1', roles: [] } }), mockRes() as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('requireAdmin (authorization)', () => {
  beforeEach(enableAuth);

  it('401 when not signed in', () => {
    const res = mockRes();
    requireAdmin(mockReq(), res as unknown as Response, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  it('403 for a signed-in non-admin', () => {
    const res = mockRes();
    requireAdmin(
      mockReq({ identity: { userId: 'u-1', roles: ['user'] } }),
      res as unknown as Response,
      jest.fn()
    );
    expect(res.statusCode).toBe(403);
    expect((res.body as { code?: string }).code).toBe('forbidden');
  });

  it('passes for an admin-role caller', () => {
    const next = jest.fn();
    requireAdmin(
      mockReq({ identity: { userId: 'u-1', roles: ['admin'] } }),
      mockRes() as unknown as Response,
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
