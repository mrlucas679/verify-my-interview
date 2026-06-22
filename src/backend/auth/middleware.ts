// Auth middleware — attaches a verified identity and enforces free-tier access.
//
// Behaviour is driven by two locked product decisions (see docs/DATA_ARCHITECTURE):
//  - Signed-in users (Google/Apple via Entra External ID) are metered monthly and
//    capped when AUTH_SIGNED_IN_MONTHLY_MAX is set.
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
import { signedInMonthlyMax } from './quota';
import {
  cosmosEnabled,
  consumeAnonTrial,
  recordUsage,
  reserveUsage,
  rollbackAnonTrial,
  rollbackUsage,
  upsertUser,
} from '../data/cosmos';
import { logger } from '../observability/logger';

type AnalyzeAccessReservation =
  | { kind: 'open' }
  | { kind: 'signed_in'; userId: string; reserved: boolean; durable: boolean; period?: string; quotaMax?: number }
  | { kind: 'anonymous'; key: string; reserved: boolean; durable: boolean };

export interface AuthedRequest extends Request {
  identity?: Identity | null;
  analyzeAccess?: AnalyzeAccessReservation;
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
const signedInCounts = new Map<string, number>();
const ANON_MAX_KEYS = 50_000;
const SIGNED_IN_MAX_KEYS = 100_000;

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

function rollbackAnonTrialMemory(key: string): void {
  const current = anonCounts.get(key) ?? 0;
  if (current <= 1) anonCounts.delete(key);
  else anonCounts.set(key, current - 1);
}

function usagePeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function reserveSignedInMemory(
  userId: string,
  max: number
): { allowed: boolean; period: string; count: number } {
  const period = usagePeriod();
  const key = `${userId}:${period}`;
  if (signedInCounts.size >= SIGNED_IN_MAX_KEYS && !signedInCounts.has(key)) {
    let evict = Math.ceil(SIGNED_IN_MAX_KEYS / 10);
    for (const k of signedInCounts.keys()) {
      if (evict-- <= 0) break;
      signedInCounts.delete(k);
    }
  }
  const count = (signedInCounts.get(key) ?? 0) + 1;
  signedInCounts.set(key, count);
  return { allowed: count <= max, period, count };
}

function rollbackSignedInMemory(userId: string, period = usagePeriod()): void {
  const key = `${userId}:${period}`;
  const current = signedInCounts.get(key) ?? 0;
  if (current <= 1) signedInCounts.delete(key);
  else signedInCounts.set(key, current - 1);
}

async function releaseSignedInReservation(access: Extract<AnalyzeAccessReservation, { kind: 'signed_in' }>): Promise<void> {
  if (!access.reserved) return;
  if (access.durable) await rollbackUsage(access.userId, access.period);
  else rollbackSignedInMemory(access.userId, access.period);
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
 * Free-tier access gate for /analyze. Signed-in ⇒ reserve a quota slot when
 * capped, otherwise meter on success. Anonymous ⇒ allow up to AUTH_ANON_TRIAL_MAX
 * trial checks, then 401 with a sign-in prompt. No-op when auth is unconfigured.
 */
export async function enforceAnalyzeAccess(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  req.analyzeAccess = { kind: 'open' };
  if (!authEnabled()) return next();

  if (req.identity) {
    const max = signedInMonthlyMax();
    if (max === null) {
      req.analyzeAccess = { kind: 'signed_in', userId: req.identity.userId, reserved: false, durable: false };
      return next();
    }
    const durable = cosmosEnabled();
    let reservation: { allowed: boolean; period: string; count: number };
    try {
      reservation = durable
        ? await reserveUsage(req.identity.userId, max)
        : reserveSignedInMemory(req.identity.userId, max);
    } catch (e) {
      logger.warn(`[Auth] signed-in quota check failed: ${e instanceof Error ? e.message : e}`);
      res.status(503).json({
        error: 'We could not confirm your account quota right now. Please try again in a moment.',
        code: 'quota_unavailable',
      });
      return;
    }
    const access: Extract<AnalyzeAccessReservation, { kind: 'signed_in' }> = {
      kind: 'signed_in',
      userId: req.identity.userId,
      reserved: true,
      durable,
      period: reservation.period,
      quotaMax: max,
    };
    if (!reservation.allowed) {
      try {
        await releaseSignedInReservation(access);
      } catch (e) {
        logger.warn(`[Auth] signed-in over-limit rollback failed: ${e instanceof Error ? e.message : e}`);
      }
      res.status(429).json({
        error: 'You have reached your monthly free check limit. Your history remains available.',
        code: 'quota_exhausted',
        quota: { period: reservation.period, limit: max },
      });
      return;
    }
    req.analyzeAccess = access;
    return next();
  }

  const max = anonTrialMax();
  if (max === 0) {
    res.status(401).json({ error: 'Please sign in with Google or Apple to verify.', code: 'auth_required' });
    return;
  }
  const key = anonKey(req.ip);
  let allowed: boolean;
  let durable = false;
  let reserved = false;
  try {
    durable = cosmosEnabled();
    allowed = durable ? await consumeAnonTrial(key, max) : consumeAnonTrialMemory(key, max);
    reserved = true;
  } catch (e) {
    // Fail open (still rate-limited): a storage hiccup must not lock visitors out.
    logger.warn(`[Auth] anon trial check failed, allowing: ${e instanceof Error ? e.message : e}`);
    allowed = true;
  }
  if (!allowed) {
    if (reserved) {
      try {
        if (durable) await rollbackAnonTrial(key);
        else rollbackAnonTrialMemory(key);
      } catch (e) {
        logger.warn(`[Auth] anon over-limit rollback failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    res.status(401).json({
      error: 'You’ve used your free trial check. Sign in with Google or Apple to continue — it’s free.',
      code: 'trial_exhausted',
    });
    return;
  }
  req.analyzeAccess = { kind: 'anonymous', key, reserved, durable };
  next();
}

/**
 * Finalise analyze access after a SUCCESSFUL investigation. Anonymous trial and
 * capped signed-in reservations are already counted. Uncapped signed-in users are
 * metered only now, so failed/aborted checks do not inflate usage history.
 */
export async function commitAnalyzeAccess(req: AuthedRequest): Promise<void> {
  const access = req.analyzeAccess;
  if (!access || access.kind !== 'signed_in' || !cosmosEnabled()) return;
  if (access.reserved) return;
  try {
    await recordUsage(access.userId);
  } catch (e) {
    logger.warn(`[Auth] usage meter failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Release a reserved trial/quota slot when /analyze fails before completion. */
export async function rollbackAnalyzeAccess(req: AuthedRequest): Promise<void> {
  const access = req.analyzeAccess;
  if (!access || (access.kind !== 'anonymous' && access.kind !== 'signed_in') || !access.reserved) return;
  try {
    if (access.kind === 'anonymous') {
      if (access.durable) await rollbackAnonTrial(access.key);
      else rollbackAnonTrialMemory(access.key);
    } else {
      await releaseSignedInReservation(access);
    }
    req.analyzeAccess = { ...access, reserved: false };
  } catch (e) {
    logger.warn(`[Auth] analyze access rollback failed: ${e instanceof Error ? e.message : e}`);
  }
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
