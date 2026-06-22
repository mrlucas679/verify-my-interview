// Unit tests for the HTTP hardening layer (src/backend/http/guard.ts):
// rate limiting, input validation, URL sanitization, and upload sniffing.

import {
  cleanString,
  cleanStringArray,
  sanitizeHttpUrl,
  securityHeaders,
  sniffAudioType,
  sniffUploadType,
  rateLimitAllow,
  resetRateLimits,
} from '../../src/backend/http/guard';
import type { NextFunction, Request, Response } from 'express';

describe('cleanString', () => {
  it('trims and caps length', () => {
    expect(cleanString('  hello  ', 10)).toBe('hello');
    expect(cleanString('abcdefghij', 5)).toBe('abcde');
  });
  it('rejects non-strings', () => {
    expect(cleanString(42, 10)).toBe('');
    expect(cleanString(null, 10)).toBe('');
    expect(cleanString(undefined, 10)).toBe('');
    expect(cleanString({}, 10)).toBe('');
  });
});

describe('cleanStringArray', () => {
  it('keeps only strings, trims, caps items and length', () => {
    expect(cleanStringArray(['a', 'b', 2, null, 'c'], 2, 10)).toEqual(['a', 'b']);
    expect(cleanStringArray([' x ', 'y'], 10, 5)).toEqual(['x', 'y']);
  });
  it('returns [] for non-arrays', () => {
    expect(cleanStringArray('nope', 5, 5)).toEqual([]);
    expect(cleanStringArray(undefined, 5, 5)).toEqual([]);
  });
});

describe('sanitizeHttpUrl', () => {
  it('passes http(s) URLs', () => {
    expect(sanitizeHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(sanitizeHttpUrl('http://a.co')).toBe('http://a.co');
  });
  it('blocks dangerous schemes', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeHttpUrl('data:text/html;base64,PHN2Zz4=')).toBe('');
    expect(sanitizeHttpUrl('file:///etc/passwd')).toBe('');
    expect(sanitizeHttpUrl('not a url')).toBe('');
    expect(sanitizeHttpUrl(123)).toBe('');
  });
});

describe('sniffUploadType (magic bytes, not client MIME)', () => {
  it('detects real formats', () => {
    expect(sniffUploadType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(sniffUploadType(Buffer.from('89504e470d0a1a0a00', 'hex'))).toBe('png');
    expect(sniffUploadType(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe('pdf');
    // Real files always carry payload past the 12-byte RIFF/WEBP header.
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(sniffUploadType(webp)).toBe('webp');
  });
  it('rejects disguised / non-image payloads (e.g. an HTML or EXE upload)', () => {
    expect(sniffUploadType(Buffer.from('<!DOCTYPE html><script>', 'latin1'))).toBeNull();
    expect(sniffUploadType(Buffer.from('MZ\x90\x00', 'latin1'))).toBeNull();
    expect(sniffUploadType(Buffer.from([0x00, 0x01, 0x02]))).toBeNull();
  });
});

describe('sniffAudioType (voice upload magic bytes)', () => {
  it('detects supported browser and mobile voice formats', () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42]);
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')]);
    const mp3 = Buffer.from('ID3\x04\x00\x00', 'latin1');
    const amr = Buffer.from('#!AMR\n\x00', 'latin1');

    expect(sniffAudioType(webm)).toBe('webm');
    expect(sniffAudioType(wav)).toBe('wav');
    expect(sniffAudioType(mp3)).toBe('mp3');
    expect(sniffAudioType(amr)).toBe('amr');
  });

  it('rejects disguised text/html uploads before Speech is called', () => {
    expect(sniffAudioType(Buffer.from('<html><script>alert(1)</script>', 'latin1'))).toBeNull();
    expect(sniffAudioType(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('rateLimitAllow (sliding window)', () => {
  beforeEach(() => resetRateLimits());

  it('allows up to max then blocks within the window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimitAllow('k', 60_000, 3, t0).allowed).toBe(true);
    }
    const blocked = rateLimitAllow('k', 60_000, 3, t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('recovers after the window slides past old hits', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 3; i++) rateLimitAllow('k2', 60_000, 3, t0);
    expect(rateLimitAllow('k2', 60_000, 3, t0).allowed).toBe(false);
    // 61s later the window has moved past all three hits.
    expect(rateLimitAllow('k2', 60_000, 3, t0 + 61_000).allowed).toBe(true);
  });

  it('isolates buckets per key (per IP+route)', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < 3; i++) rateLimitAllow('ipA', 60_000, 3, t0);
    expect(rateLimitAllow('ipA', 60_000, 3, t0).allowed).toBe(false);
    expect(rateLimitAllow('ipB', 60_000, 3, t0).allowed).toBe(true);
  });
});

describe('securityHeaders', () => {
  const saved = {
    AUTH_ISSUER: process.env.AUTH_ISSUER,
    VITE_AUTH_AUTHORITY: process.env.VITE_AUTH_AUTHORITY,
  };

  afterEach(() => {
    if (saved.AUTH_ISSUER === undefined) delete process.env.AUTH_ISSUER;
    else process.env.AUTH_ISSUER = saved.AUTH_ISSUER;
    if (saved.VITE_AUTH_AUTHORITY === undefined) delete process.env.VITE_AUTH_AUTHORITY;
    else process.env.VITE_AUTH_AUTHORITY = saved.VITE_AUTH_AUTHORITY;
  });

  function cspForEnv(): string {
    const headers = new Map<string, string>();
    const res = {
      setHeader: (name: string, value: string) => {
        headers.set(name, value);
      },
    } as Pick<Response, 'setHeader'>;
    securityHeaders({} as Request, res as Response, jest.fn() as NextFunction);
    return headers.get('Content-Security-Policy') ?? '';
  }

  it('allows the exact configured CIAM token origin in connect-src', () => {
    process.env.AUTH_ISSUER = 'https://tenant.ciamlogin.com/tenant-id/v2.0';
    const csp = cspForEnv();
    expect(csp).toContain("connect-src 'self' https://tenant.ciamlogin.com");
  });

  it('ignores non-https auth origins instead of widening CSP', () => {
    delete process.env.AUTH_ISSUER;
    process.env.VITE_AUTH_AUTHORITY = 'http://evil.example.test/tenant';
    const csp = cspForEnv();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('evil.example.test');
  });

  it('does not depend on remote font stylesheet origins', () => {
    const csp = cspForEnv();
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toContain('fonts.googleapis.com');
    expect(csp).not.toContain('fonts.gstatic.com');
  });
});
