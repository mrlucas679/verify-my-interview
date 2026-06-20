// Link-shortener / redirect unwrapping.
//
// A scammer hides the real "apply here" destination behind bit.ly / tinyurl etc.
// When URL_UNWRAP_ENABLED=1 this resolves a shortened link to its final domain so
// the verification tools analyse the TRUE destination, not the wrapper. Key-gated
// so offline evals make no network call (URL_UNWRAP_ENABLED is scrubbed). Bounded
// hops + timeout; never throws (failure ⇒ the original link is kept).

import axios from 'axios';
import { lookup } from 'dns/promises';
import net from 'net';
import { Entities } from '../../types/entities';
import { URL_SHORTENERS } from '../scorer/signalEngine';
import { normalizeDomain } from '../network/entityGraph';
import { logger } from '../observability/logger';

const MAX_HOPS = 5;
const TIMEOUT_MS = 6_000;

export function urlUnwrapEnabled(): boolean {
  return process.env.URL_UNWRAP_ENABLED === '1';
}

function hostOf(raw: string): string {
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isShortener(host: string): boolean {
  return URL_SHORTENERS.has(host);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  throw reason instanceof Error ? reason : new Error('URL unwrap aborted');
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a === 0 ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fe80:') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

async function safeHttpUrl(raw: string, base?: string, signal?: AbortSignal): Promise<string | null> {
  throwIfAborted(signal);
  let parsed: URL;
  try {
    parsed = base ? new URL(raw, base) : new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') return null;

  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  if (net.isIP(host)) return isPrivateAddress(host) ? null : parsed.toString();

  try {
    const records = await lookup(host, { all: true, verbatim: false });
    throwIfAborted(signal);
    if (!records.length || records.some((record) => isPrivateAddress(record.address))) return null;
  } catch {
    throwIfAborted(signal);
    return null;
  }
  return parsed.toString();
}

/** Follow redirects manually (bounded) and return the final URL, or null. */
async function resolveFinalUrl(url: string, signal?: AbortSignal): Promise<string | null> {
  let current = await safeHttpUrl(url, undefined, signal);
  if (!current) return null;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    throwIfAborted(signal);
    let res;
    try {
      res = await axios.head(current, {
        maxRedirects: 0,
        signal,
        timeout: TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    } catch (e: any) {
      throwIfAborted(signal);
      // Some hosts reject HEAD — fall back to a single GET without following.
      if (e?.response?.headers?.location) {
        res = e.response;
      } else {
        return current === url ? null : current;
      }
    }
    const location = res.headers?.location;
    if (!location) return current; // no more redirects → final
    const next = await safeHttpUrl(location, current, signal);
    if (!next) {
      return current;
    }
    current = next;
  }
  return current;
}

/**
 * For each shortened URL in the evidence, resolve it and add the real destination
 * domain to `entities.domains` (deduped) so the verification stage checks it.
 * No-op when disabled or when there are no shortened links.
 */
export async function expandShortenedUrls(entities: Entities, signal?: AbortSignal): Promise<void> {
  if (!urlUnwrapEnabled() || !entities.urls?.length) return;
  const shortened = entities.urls.filter((u) => isShortener(hostOf(u))).slice(0, 5);
  for (const url of shortened) {
    throwIfAborted(signal);
    const final = await resolveFinalUrl(url, signal);
    if (!final) continue;
    const host = hostOf(final);
    if (host && !isShortener(host)) {
      const domain = normalizeDomain(host);
      if (!entities.domains.includes(domain)) {
        entities.domains.push(domain);
        logger.debug(`[UrlUnwrap] ${hostOf(url)} → ${domain}`);
      }
    }
  }
}
