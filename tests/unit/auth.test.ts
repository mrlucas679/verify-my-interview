// Unit tests for the authentication/authorization boundary:
//   - identity.isAdmin  — the AUTHORIZATION decision (admin allow-list + role claim)
//   - identity.authEnabled — env-gating
//   - blob.isOwnedEvidenceId — the IDOR guard for evidence downloads
//
// These are the security-critical pure functions; they must be exhaustively tested
// because a wrong answer means privilege escalation or cross-user data exposure.

import {
  adminViaEmailAllowlist,
  authEnabled,
  isAdmin,
  type Identity,
} from '../../src/backend/auth/identity';
import { isOwnedEvidenceId } from '../../src/backend/storage/blob';

function identity(partial: Partial<Identity>): Identity {
  return { userId: 'u-1', roles: [], ...partial };
}

describe('authEnabled', () => {
  const saved = { iss: process.env.AUTH_ISSUER, aud: process.env.AUTH_AUDIENCE };
  afterEach(() => {
    process.env.AUTH_ISSUER = saved.iss;
    process.env.AUTH_AUDIENCE = saved.aud;
  });

  it('is false unless BOTH issuer and audience are set', () => {
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_AUDIENCE;
    expect(authEnabled()).toBe(false);
    process.env.AUTH_ISSUER = 'https://tenant.ciamlogin.com/x/v2.0';
    expect(authEnabled()).toBe(false); // audience still missing
    process.env.AUTH_AUDIENCE = 'api-client-id';
    expect(authEnabled()).toBe(true);
  });
});

describe('isAdmin', () => {
  const savedEmails = process.env.AUTH_ADMIN_EMAILS;
  afterEach(() => {
    if (savedEmails === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = savedEmails;
  });

  it('returns false for a missing identity', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('grants admin via the token roles claim', () => {
    delete process.env.AUTH_ADMIN_EMAILS;
    expect(isAdmin(identity({ roles: ['admin'] }))).toBe(true);
    expect(isAdmin(identity({ roles: ['user'] }))).toBe(false);
  });

  it('grants admin via the fixed email allow-list, case-insensitively', () => {
    process.env.AUTH_ADMIN_EMAILS = 'Boss@Example.com, ops@example.com';
    expect(isAdmin(identity({ email: 'boss@example.com' }))).toBe(true);
    expect(isAdmin(identity({ email: 'BOSS@EXAMPLE.COM' }))).toBe(true);
    expect(isAdmin(identity({ email: 'ops@example.com' }))).toBe(true);
    expect(isAdmin(identity({ email: 'intruder@example.com' }))).toBe(false);
  });

  it('fails closed: no role, no allow-list, no email', () => {
    delete process.env.AUTH_ADMIN_EMAILS;
    expect(isAdmin(identity({}))).toBe(false);
    process.env.AUTH_ADMIN_EMAILS = '';
    expect(isAdmin(identity({ email: 'someone@example.com' }))).toBe(false);
  });

  it('does not grant admin when the identity has no email but a list is set', () => {
    process.env.AUTH_ADMIN_EMAILS = 'boss@example.com';
    expect(isAdmin(identity({ email: undefined }))).toBe(false);
  });
});

describe('adminViaEmailAllowlist (break-glass observability)', () => {
  const savedEmails = process.env.AUTH_ADMIN_EMAILS;
  afterEach(() => {
    if (savedEmails === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = savedEmails;
  });

  it('is true ONLY when the email list (not a role) is what grants admin', () => {
    process.env.AUTH_ADMIN_EMAILS = 'boss@example.com';
    expect(adminViaEmailAllowlist(identity({ email: 'boss@example.com' }))).toBe(true);
    // Granted by role → not a break-glass grant.
    expect(adminViaEmailAllowlist(identity({ email: 'boss@example.com', roles: ['admin'] }))).toBe(false);
    // Not an admin at all.
    expect(adminViaEmailAllowlist(identity({ email: 'nobody@example.com' }))).toBe(false);
  });
});

describe('isOwnedEvidenceId (IDOR guard)', () => {
  // Real Entra `oid` is a GUID *with hyphens* — this is the regression test for
  // the bug where the id pattern rejected hyphenated user ids.
  const guid = '4f8e1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';
  const ownId = `${guid}/0123456789abcdef0123456789abcdef.jpg`;

  it('accepts a user reading their own well-formed evidence id (GUID userId)', () => {
    expect(isOwnedEvidenceId(guid, ownId)).toBe(true);
  });

  it('accepts base64url-style sub user ids (letters, _ and -)', () => {
    const sub = 'AbC_1-dEf2';
    expect(isOwnedEvidenceId(sub, `${sub}/0123456789abcdef0123456789abcdef`)).toBe(true);
  });

  it('rejects another user\'s evidence id', () => {
    const other = '00000000-0000-0000-0000-000000000000';
    expect(isOwnedEvidenceId(other, ownId)).toBe(false);
  });

  it('rejects a prefix-collision attack (trailing slash required)', () => {
    // userId "abc" must NOT be able to read "abcd/..." just because it starts-with.
    expect(isOwnedEvidenceId('abc', 'abcd/0123456789abcdef0123456789abcdef')).toBe(false);
  });

  it('rejects path traversal and malformed ids', () => {
    expect(isOwnedEvidenceId(guid, `${guid}/../secrets`)).toBe(false);
    expect(isOwnedEvidenceId(guid, `../../${guid}/x`)).toBe(false);
    expect(isOwnedEvidenceId(guid, `${guid}/not-hex`)).toBe(false);
    expect(isOwnedEvidenceId(guid, guid)).toBe(false); // no file segment
    expect(isOwnedEvidenceId('', '')).toBe(false);
  });
});
