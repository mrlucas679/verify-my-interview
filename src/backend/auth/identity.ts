// Identity — validates a bearer JWT from Microsoft Entra External ID (CIAM).
//
// Google and Apple are configured as social identity providers INSIDE Entra
// External ID, so the API only ever trusts ONE issuer (Entra) and validates its
// signature against the published JWKS. Microsoft handles credential security;
// we verify the token's signature, issuer, audience, and expiry, then read the
// stable subject claim as the user id.
//
// Conventions (CLAUDE.md): env-gated (rule 2) — with AUTH_ISSUER / AUTH_AUDIENCE
// unset, authEnabled() is false and the API behaves exactly as today (stateless,
// anonymous, no accounts). Offline evals scrub AUTH_* so they stay deterministic
// (rule 3). The token is untrusted input: every claim is validated, never assumed
// (rule 5), and all derived strings are length-capped (rule 3).

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { logger } from '../observability/logger';

/** A verified caller. Only the fields we actually use, all bounded. */
export interface Identity {
  /** Stable Entra subject (oid/sub) — the user id (`users._id`). */
  userId: string;
  email?: string;
  name?: string;
  /** Upstream social IdP if Entra surfaced it ("google.com" / "apple.com"). */
  provider?: string;
  /**
   * Authorization roles from the token's `roles` claim (Entra app roles). The
   * TOKEN is the single source of truth for authorization — we never read a
   * role back from the database, so tampering with a `users` document can never
   * escalate privilege (least-privilege + explicit-over-implicit). Empty ⇒ a
   * plain user; "admin" grants destructive/moderation actions.
   */
  roles: string[];
}

/** Fixed admin allow-list (AUTH_ADMIN_EMAILS) — normalised, deduped. */
function adminEmails(): string[] {
  return (process.env.AUTH_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Authorization check for administrator actions. Admin status is granted by EITHER
 * mechanism, both anchored to the cryptographically VERIFIED token (so neither can
 * be forged client-side):
 *   1. a fixed `AUTH_ADMIN_EMAILS` allow-list matched against the token's verified
 *      email (the operator's preferred, explicit approach — no Entra role wiring
 *      needed), or
 *   2. the `admin` app-role in the token's `roles` claim.
 * Fails closed: no token, no email, and no configured admins ⇒ not an admin.
 */
export function isAdmin(identity: Identity | null | undefined): boolean {
  if (!identity) return false;
  if (identity.roles.includes('admin')) return true;
  const email = identity.email?.trim().toLowerCase();
  return Boolean(email && adminEmails().includes(email));
}

/**
 * True when admin would be granted ONLY by the break-glass email allow-list (not by
 * an app role). Lets the request layer log when the temporary fallback is exercised,
 * so its use is observable and you know a proper Entra role still needs assigning.
 */
export function adminViaEmailAllowlist(identity: Identity | null | undefined): boolean {
  if (!identity || identity.roles.includes('admin')) return false;
  const email = identity.email?.trim().toLowerCase();
  return Boolean(email && adminEmails().includes(email));
}

export class AuthError extends Error {}

export function authEnabled(): boolean {
  return Boolean(process.env.AUTH_ISSUER && process.env.AUTH_AUDIENCE);
}

function issuer(): string {
  return (process.env.AUTH_ISSUER as string).replace(/\/+$/, '');
}

// JWKS is fetched once and cached/refreshed by jose (keyed to the issuer's
// well-known endpoint). Rebuilt only if the issuer env changes between calls.
let jwksUri = '';
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export function jwksUriForIssuer(value: string): string {
  const base = value.replace(/\/+$/, '').replace(/\/v2\.0$/i, '');
  return `${base}/discovery/v2.0/keys`;
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  // Entra exposes keys beside the v2 issuer path:
  //   issuer: https://.../<tenant>/v2.0
  //   keys:   https://.../<tenant>/discovery/v2.0/keys
  // AUTH_JWKS_URI remains available for non-standard tenants.
  const uri = process.env.AUTH_JWKS_URI || jwksUriForIssuer(issuer());
  if (!jwks || uri !== jwksUri) {
    jwksUri = uri;
    jwks = createRemoteJWKSet(new URL(uri));
  }
  return jwks;
}

function cap(value: unknown, maxLen: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLen) : undefined;
}

/** Read the bounded `roles` claim (Entra app roles) as a clean string list. */
function rolesFrom(payload: JWTPayload): string[] {
  const raw = (payload as Record<string, unknown>).roles;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is string => typeof r === 'string')
    .map((r) => r.trim().slice(0, 64))
    .filter(Boolean)
    .slice(0, 20);
}

function toIdentity(payload: JWTPayload): Identity {
  const userId = cap(payload.oid ?? payload.sub, 128);
  if (!userId) throw new AuthError('token has no subject');
  return {
    userId,
    email: cap(payload.email ?? (payload as Record<string, unknown>).preferred_username, 254),
    name: cap(payload.name, 120),
    provider: cap((payload as Record<string, unknown>).idp, 64),
    roles: rolesFrom(payload),
  };
}

/**
 * Verify a bearer token and return the caller's Identity. Throws AuthError on any
 * invalid/expired/untrusted token. Audience is matched against AUTH_AUDIENCE; a
 * comma list is supported for tenants that issue multiple valid audiences.
 */
export async function verifyToken(token: string): Promise<Identity> {
  if (!authEnabled()) throw new AuthError('auth is not configured');
  const audience = (process.env.AUTH_AUDIENCE as string)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: issuer(),
      audience,
      clockTolerance: 5,
    });
    return toIdentity(payload);
  } catch (error) {
    // Never leak the underlying jose error detail to the client.
    logger.warn(`[Auth] token rejected: ${error instanceof Error ? error.message : error}`);
    throw new AuthError('invalid or expired token');
  }
}
