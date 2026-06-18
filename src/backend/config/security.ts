// Production security-config assertions (FAIL FAST).
//
// CLAUDE.md rule 2 (graceful degradation) is the right default for dev / offline /
// demo: an unset capability simply no-ops. In PRODUCTION the same silence is a
// vulnerability — a missing env var can disable auth, the anonymous-trial gate, or
// correct client-IP attribution with nobody noticing (/health still says "ok").
//
// This module resolves that tension the only safe way: environment-aware. Dev stays
// lenient; production FAILS FAST (principles: fail fast, explicit over implicit). At
// boot we assert the intended controls are actually configured and refuse to start
// otherwise — unless the operator sets ALLOW_INSECURE=1, which downgrades the hard
// failures to loud warnings (an explicit, audited escape hatch). Only the HTTP
// runtime calls assertSecureConfig(); the local CLI/MCP surfaces are read-only and
// non-networked, so these network controls don't apply to them.

import { authEnabled } from '../auth/identity';
import { cosmosEnabled } from '../data/cosmos';
import { azureMonitorConfigured } from '../observability/telemetry';
import { logger } from '../observability/logger';

export class SecurityConfigError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Refusing to start: insecure production configuration:\n - ${violations.join('\n - ')}`);
    this.name = 'SecurityConfigError';
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function allowInsecure(): boolean {
  return process.env.ALLOW_INSECURE === '1';
}

/**
 * Every HARD production security violation (empty outside production). These are
 * controls whose absence creates an actual vulnerability — not mere best practice.
 */
export function securityConfigViolations(): string[] {
  if (!isProduction()) return [];
  const v: string[] = [];

  // Client-IP attribution. Rate limiting and the anonymous-trial gate key on
  // req.ip. Behind Container Apps / App Service ingress WITHOUT trust-proxy, every
  // request appears to originate from the proxy hop: the limiter degrades into a
  // global self-DoS, and the single anonymous trial is shared by ALL visitors.
  if (process.env.TRUST_PROXY !== '1') {
    v.push(
      'TRUST_PROXY must be "1" in production (behind ingress) so rate limiting and the anon-trial gate use the real client IP, not the proxy hop.'
    );
  }

  // Authentication. The free tier (accounts, usage metering, the trial gate) only
  // exists when auth is configured; without it the API is fully open + unlimited.
  if (!authEnabled()) {
    v.push(
      'AUTH_ISSUER and AUTH_AUDIENCE must be set in production — without them accounts/auth are disabled and the API is fully open and unlimited.'
    );
  } else {
    // With auth on, account/usage/trial state must be durable and cross-replica,
    // and the anon-trial hash needs a stable salt (else trials reset per process).
    if (!cosmosEnabled()) {
      v.push(
        'COSMOS_CONNECTION_STRING must be set in production when auth is enabled — accounts, usage metering, and the anon-trial gate need a durable, cross-replica store (the in-memory fallback is per-process and bypassable).'
      );
    }
    if (!process.env.AUTH_ANON_SALT) {
      v.push(
        'AUTH_ANON_SALT must be set in production so the anonymous-trial IP hash is stable across restarts and replicas (otherwise the "1 free trial" resets per process).'
      );
    }
  }

  return v;
}

/** Loud-but-non-fatal production warnings (best practice, not a vulnerability). */
export function securityConfigWarnings(): string[] {
  if (!isProduction()) return [];
  const w: string[] = [];
  if (!azureMonitorConfigured()) {
    w.push(
      'APPLICATIONINSIGHTS_CONNECTION_STRING is not set — running in production without telemetry/monitoring (you are flying blind).'
    );
  }
  if ((process.env.AUTH_ADMIN_EMAILS || '').trim()) {
    w.push(
      'AUTH_ADMIN_EMAILS is set — this is a TEMPORARY break-glass admin path. Prefer Entra app roles and clear it once a role is assigned.'
    );
  }
  return w;
}

/**
 * Assert a secure production configuration at boot. Always logs warnings. Throws
 * SecurityConfigError on hard violations, unless ALLOW_INSECURE=1 downgrades them to
 * warnings (and logs that the escape hatch is active). No-op outside production.
 */
export function assertSecureConfig(): void {
  for (const warning of securityConfigWarnings()) logger.warn(`[Config] ${warning}`);

  const violations = securityConfigViolations();
  if (violations.length === 0) return;

  if (allowInsecure()) {
    logger.warn('[Config] ALLOW_INSECURE=1 — starting DESPITE an insecure production configuration:');
    for (const violation of violations) logger.warn(`[Config]   - ${violation}`);
    return;
  }
  throw new SecurityConfigError(violations);
}
