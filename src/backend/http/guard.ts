// HTTP hardening: rate limiting, security headers, audit logging, input
// validation, and upload sniffing. Hand-rolled (no new dependencies) and
// in-memory — right-sized for a single-instance deployment; swap the limiter
// store for Redis when scaling out.
//
// Threat model notes:
//  - Evidence and reports are UNTRUSTED text; every endpoint validates type,
//    shape, and size before any work happens (DoS + crash resistance).
//  - External API responses are also untrusted: `sanitizeHttpUrl` and
//    `cleanString` are used at the boundaries so a hostile/compromised search
//    or WHOIS payload cannot smuggle javascript: URLs or megabyte strings
//    into reports the UI renders.
//  - The audit log carries NO content and no raw IPs (POPIA minimality):
//    method, path, status, latency, and a salted IP hash for abuse tracing.

import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

// ── Validation helpers ──────────────────────────────────────────────────────

/** Coerce to a trimmed string and hard-cap its length; '' when not a string. */
export function cleanString(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

/** Keep only string elements, trimmed and capped, up to maxItems. */
export function cleanStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().slice(0, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Allow only http(s) URLs (blocks javascript:, data:, file: …); '' otherwise. */
export function sanitizeHttpUrl(v: unknown, maxLen = 500): string {
  const s = cleanString(v, maxLen);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch {
    /* not a URL */
  }
  return '';
}

// ── Upload sniffing (magic bytes, not client-supplied MIME) ─────────────────

const UPLOAD_TYPES: Array<{ kind: string; test: (b: Buffer) => boolean }> = [
  { kind: 'jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    kind: 'png',
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  { kind: 'pdf', test: (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === '%PDF' },
  {
    kind: 'tiff',
    test: (b) =>
      b.length > 4 &&
      (b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
        b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))),
  },
  {
    kind: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { kind: 'bmp', test: (b) => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d },
  {
    kind: 'heic',
    test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp',
  },
];

/**
 * Identify an uploaded buffer by magic bytes. Returns the detected kind
 * ('jpeg' | 'png' | 'pdf' | …) or null when it is not a supported evidence
 * format. Never trust the client's Content-Type or file extension.
 */
export function sniffUploadType(buffer: Buffer): string | null {
  for (const t of UPLOAD_TYPES) {
    if (t.test(buffer)) return t.kind;
  }
  return null;
}

const AUDIO_TYPES: Array<{ kind: string; test: (b: Buffer) => boolean }> = [
  // RIFF....WAVE
  {
    kind: 'wav',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WAVE',
  },
  // MP3: ID3 tag or MPEG frame sync (0xFFEx/0xFFFx)
  {
    kind: 'mp3',
    test: (b) =>
      (b.length > 3 && b.subarray(0, 3).toString('latin1') === 'ID3') ||
      (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
  },
  // ISO-BMFF (m4a/aac/mp4 audio): 'ftyp' at offset 4
  { kind: 'm4a', test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' },
  // OGG / Opus
  { kind: 'ogg', test: (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === 'OggS' },
  // FLAC
  { kind: 'flac', test: (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === 'fLaC' },
  // WebM / Matroska (EBML header) — MediaRecorder default in browsers
  {
    kind: 'webm',
    test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
  // AMR (common on mobile voice notes)
  {
    kind: 'amr',
    test: (b) => b.length > 6 && b.subarray(0, 6).toString('latin1') === '#!AMR\n',
  },
];

/**
 * Identify an uploaded audio buffer by magic bytes (WAV/MP3/M4A/OGG/FLAC/WebM/
 * AMR). Returns the detected kind or null when it is not a supported audio
 * format — so a disguised payload can't reach the speech service.
 */
export function sniffAudioType(buffer: Buffer): string | null {
  for (const t of AUDIO_TYPES) {
    if (t.test(buffer)) return t.kind;
  }
  return null;
}

// ── Rate limiting (sliding window, per IP + route) ──────────────────────────

interface LimiterOptions {
  windowMs: number;
  max: number;
  /** Route tag for the audit log + separate buckets per route. */
  name: string;
}

/** Internal store shared across limiters; pruned on access + by a sweeper. */
const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 50_000; // hard memory ceiling under address-spoofing floods

// Sweep idle buckets every 10 minutes; unref so tests/processes can exit.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] < cutoff) buckets.delete(key);
  }
}, 10 * 60 * 1000);
sweeper.unref?.();

/** Pure decision function (exported for unit tests). */
export function rateLimitAllow(
  key: string,
  windowMs: number,
  max: number,
  now = Date.now()
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size >= MAX_BUCKETS) {
      // Memory ceiling under address-spoofing floods: evict the oldest tenth
      // (Map preserves insertion order) instead of clearing — established
      // clients keep their counters, so the limiter never fails open.
      let toEvict = Math.ceil(MAX_BUCKETS / 10);
      for (const k of buckets.keys()) {
        if (toEvict-- <= 0) break;
        buckets.delete(k);
      }
    }
    hits = [];
    buckets.set(key, hits);
  }
  const windowStart = now - windowMs;
  while (hits.length && hits[0] <= windowStart) hits.shift();
  if (hits.length >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }
  hits.push(now);
  return { allowed: true, remaining: max - hits.length, retryAfterSec: 0 };
}

/** Express middleware factory. */
export function rateLimit(opts: LimiterOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${opts.name}|${req.ip ?? 'unknown'}`;
    const verdict = rateLimitAllow(key, opts.windowMs, opts.max);
    res.setHeader('RateLimit-Limit', String(opts.max));
    res.setHeader('RateLimit-Remaining', String(verdict.remaining));
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSec));
      return res.status(429).json({
        error: `Too many requests — please wait ${verdict.retryAfterSec}s and try again.`,
      });
    }
    next();
  };
}

/** Test hook: clear all limiter state. */
export function resetRateLimits(): void {
  buckets.clear();
}

// ── Security headers ────────────────────────────────────────────────────────

/**
 * Conservative headers for an API + same-origin SPA. CSP allows exactly what
 * the built frontend uses: self-hosted scripts, inline styles (React style
 * attributes), system/self-hosted fonts, data: images (canvas/graph),
 * same-origin fetches, and the exact configured Entra CIAM origin for PKCE
 * token calls when auth is enabled.
 */
function ciamConnectSources(): string[] {
  const sources = new Set<string>(["'self'"]);
  for (const value of [process.env.AUTH_ISSUER, process.env.VITE_AUTH_AUTHORITY]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && /^[a-z0-9.-]+$/i.test(url.hostname)) {
        sources.add(url.origin);
      }
    } catch {
      /* Invalid auth config is handled by config/security.ts. */
    }
  }
  sources.add('https://login.microsoftonline.com');
  sources.add('https://*.ciamlogin.com');
  sources.add('https://*.b2clogin.com');
  return [...sources];
}

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // microphone=(self): the Voice Investigation recorder needs getUserMedia on
  // our own origin; camera/geolocation stay fully denied.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      `connect-src ${ciamConnectSources().join(' ')}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
}

// ── Audit logging (content-free, POPIA-safe) ────────────────────────────────

const ipSalt = crypto.randomBytes(16).toString('hex');

function hashIp(ip: string | undefined): string {
  return crypto
    .createHash('sha256')
    .update(`${ipSalt}|${ip ?? ''}`)
    .digest('hex')
    .slice(0, 12);
}

/** One JSON line per request: method, path, status, latency, salted IP hash. */
export function auditLog(req: Request, res: Response, next: NextFunction): void {
  const started = Date.now();
  res.on('finish', () => {
    // Never log query strings or bodies — they can carry evidence text/PII.
    const line = {
      t: new Date().toISOString(),
      m: req.method,
      p: req.path.slice(0, 120),
      s: res.statusCode,
      ms: Date.now() - started,
      ip: hashIp(req.ip),
    };
    console.log(`[audit] ${JSON.stringify(line)}`);
  });
  next();
}

// Note: the optional API-key check for POST /report lives in the application
// core (`appTools.submitReportLocal` → `apiKeyMatches`, constant-time), so it
// applies uniformly across the HTTP server, CLI, and MCP surfaces — there is no
// separate Express middleware gate.
