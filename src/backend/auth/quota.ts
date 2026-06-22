// Free-tier quota policy helpers. Kept separate so boot-time security checks,
// auth middleware, and account/profile surfaces parse quota env consistently.

const MAX_SIGNED_IN_MONTHLY_CHECKS = 100_000;

/** Positive integer monthly cap for signed-in users; null means unlimited/dev. */
export function signedInMonthlyMax(): number | null {
  const raw = process.env.AUTH_SIGNED_IN_MONTHLY_MAX?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(MAX_SIGNED_IN_MONTHLY_CHECKS, Math.floor(n));
}
