// Auth middleware — attaches a verified identity and enforces free-tier access.
//
// Behaviour is driven by two locked product decisions (see docs/DATA_ARCHITECTURE):
//  - Signed-in users (Google/Apple via Entra External ID) get UNLIMITED checks for
//    now; usage is METERED (recorded) but never blocked.
//  - Anonymous visitors get a small number of TRIAL checks (AUTH_ANON_TRIAL_MAX,
//    default 1), then must sign in.
//
// Graceful degradation (CLAUDE.md rule 2): when AUTH_ISSUER/AUTH_AUDIENCE are unset
// (authEnabled() === false) the API is fully open and stateless, exactly as today —
// no identity, no metering, no trial gate. So offline/dev and the CLI/MCP cores are
// unaffected.

import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { Identity, AuthError, adminViaEmailAllowlist, authEnabled, isAdmin, verifyToken } from './identity';
import { cosmosEnabled, consumeAnonTrial, recordUsage, upsertUser } from '../data/cosmos';
import { logger } from '../observability/logger';

export interface AuthedRequest extends Request {
  identity?: Identity | null;
}

function anonTrialMax(): number {
  const n = Number(process.env.AUTH_ANON_TRIAL_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.min(100, Math.floor(n)) : 1;
}

const anonSalt = process.env.AUTH_ANON_SALT || crypto.randomBytes(16).toString('hex');

/** Stable hashed key for an anonymous caller (POPIA: never store the raw IP). */
function anonKey(ip: string | undefined): string {
  return crypto.createHash('sha256').update(`${anonSalt}|${ip ?? ''}`).digest('hex');
}

// In-memory anon-trial fallback for when Cosmos is unconfigured (auth on, no DB):
// bounded so a spoofing flood can't exhaust memory; the per-IP rate limiter is the
// real abuse bound. Counts reset on restart — acceptable without a durable store.
const anonCounts = new Map<string, number>();
const ANON_MAX_KEYS = 50_000;

function consumeAnonTrialMemory(key: string, max: number): boolean {
  if (anonCounts.size >= ANON_MAX_KEYS && !anonCounts.has(key)) {
    let evict = Math.ceil(ANON_MAX_KEYS / 10);
    for (const k of anonCounts.keys()) {
      if (evict-- <= 0) break;
      anonCounts.delete(k);
    }
  }
  const next = (anonCounts.get(key) ?? 0) + 1;
  anonCounts.set(key, next);
  return next <= max;
}

/**
 * Verify the bearer token (if present) and attach req.identity. A PRESENT but
 * invalid/expired token is rejected (401); a missing token is allowed through as
 * anonymous (req.identity = null) so the trial gate downstream can decide.
 */
export async function attachIdentity(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.identity = null;
  if (!authEnabled()) return next();

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next();

  try {
    const identity = await verifyToken(token);
    req.identity = identity;
    // Best-effort profile upsert — never blocks the request or fails it.
    if (cosmosEnabled()) {
      void upsertUser({
        id: identity.userId,
        email: identity.email,
        name: identity.name,
        provider: identity.provider,
      }).catch((e) => logger.warn(`[Auth] user upsert failed: ${e instanceof Error ? e.message : e}`));
    }
    next();
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(401).json({ error: 'Your session has expired — please sign in again.' });
      return;
    }
    next(error);
  }
}

/**
 * Free-tier access gate for /analyze. Signed-in ⇒ meter + allow (unlimited for
 * now). Anonymous ⇒ allow up to AUTH_ANON_TRIAL_MAX trial checks, then 401 with a
 * sign-in prompt. No-op when auth is unconfigured.
 */
export async function enforceAnalyzeAccess(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!authEnabled()) return next();

  if (req.identity) {
    if (cosmosEnabled()) {
      void recordUsage(req.identity.userId).catch((e) =>
        logger.warn(`[Auth] usage meter failed: ${e instanceof Error ? e.message : e}`)
      );
    }
    return next();
  }

  const max = anonTrialMax();
  if (max === 0) {
    res.status(401).json({ error: 'Please sign in with Google or Apple to verify.', code: 'auth_required' });
    return;
  }
  const key = anonKey(req.ip);
  let allowed: boolean;
  try {
    allowed = cosmosEnabled() ? await consumeAnonTrial(key, max) : consumeAnonTrialMemory(key, max);
  } catch (e) {
    // Fail open (still rate-limited): a storage hiccup must not lock visitors out.
    logger.warn(`[Auth] anon trial check failed, allowing: ${e instanceof Error ? e.message : e}`);
    allowed = true;
  }
  if (!allowed) {
    res.status(401).json({
      error: 'You’ve used your free trial check. Sign in with Google or Apple to continue — it’s free.',
      code: 'trial_exhausted',
    });
    return;
  }
  next();
}

/** Require a signed-in user (for account routes). 401 otherwise. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!authEnabled()) {
    res.status(503).json({ error: 'Accounts are not enabled on this server.' });
    return;
  }
  if (!req.identity) {
    res.status(401).json({ error: 'Please sign in to access your account.', code: 'auth_required' });
    return;
  }
  next();
}

/**
 * AUTHORIZATION gate for destructive / cross-user operations (deleting community
 * data, moderating another user's submissions). Authentication proves WHO you are;
 * this proves you're ALLOWED. Self-service erasure of your OWN data does NOT use
 * this — ownership is enforced by scoping those queries to req.identity.userId.
 * Reserve requireAdmin for actions on data the caller does not own. 401 when not
 * signed in, 403 when signed in without the admin role.
 */
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!authEnabled()) {
    res.status(503).json({ error: 'Administration is not enabled on this server.' });
    return;
  }
  if (!req.identity) {
    res.status(401).json({ error: 'Please sign in.', code: 'auth_required' });
    return;
  }
  if (!isAdmin(req.identity)) {
    res.status(403).json({ error: 'Administrator access is required for this action.', code: 'forbidden' });
    return;
  }
  // Observable break-glass: record when admin was granted by the TEMPORARY email
  // allow-list rather than an Entra app role. Content-free (no email) per POPIA.
  if (adminViaEmailAllowlist(req.identity)) {
    logger.warn('[Auth] admin action authorized via break-glass AUTH_ADMIN_EMAILS — assign an Entra app role to replace this.');
  }
  next();
}
