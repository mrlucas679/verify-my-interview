// Link-shortener / redirect unwrapping.
//
// A scammer hides the real "apply here" destination behind bit.ly / tinyurl etc.
// When URL_UNWRAP_ENABLED=1 this resolves a shortened link to its final domain so
// the verification tools analyse the TRUE destination, not the wrapper. Key-gated
// so offline evals make no network call (URL_UNWRAP_ENABLED is scrubbed). Bounded
// hops + timeout; never throws (failure ⇒ the original link is kept).

import axios from 'axios';
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

/** Follow redirects manually (bounded) and return the final URL, or null. */
async function resolveFinalUrl(url: string): Promise<string | null> {
  let current = url.startsWith('http') ? url : `https://${url}`;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res;
    try {
      res = await axios.head(current, {
        maxRedirects: 0,
        timeout: TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 400,
      });
    } catch (e: any) {
      // Some hosts reject HEAD — fall back to a single GET without following.
      if (e?.response?.headers?.location) {
        res = e.response;
      } else {
        return current === url ? null : current;
      }
    }
    const location = res.headers?.location;
    if (!location) return current; // no more redirects → final
    try {
      current = new URL(location, current).toString();
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * For each shortened URL in the evidence, resolve it and add the real destination
 * domain to `entities.domains` (deduped) so the verification stage checks it.
 * No-op when disabled or when there are no shortened links.
 */
export async function expandShortenedUrls(entities: Entities): Promise<void> {
  if (!urlUnwrapEnabled() || !entities.urls?.length) return;
  const shortened = entities.urls.filter((u) => isShortener(hostOf(u))).slice(0, 5);
  for (const url of shortened) {
    const final = await resolveFinalUrl(url);
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
