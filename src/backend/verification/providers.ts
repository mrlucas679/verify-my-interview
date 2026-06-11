// Real external verification providers (OSINT enrichment).
//
// Every function here is a *capability that degrades gracefully*: it returns
// `null` (a clean no-op) whenever its credential/flag is absent, times out
// quickly, and never throws — so the deterministic pipeline is unchanged when
// nothing is configured (this is also what keeps offline evals reproducible:
// runEvals scrubs these env vars). When keys ARE present, these turn the
// signal engine's domain/phone/email checks from heuristics into real findings.
//
// POPIA data-minimization (s10): we deliberately DROP person-level fields the
// providers return (e.g. a phone's registered owner name, an email's sender
// name). Risk assessment needs the line type / reputation / domain age — never
// the human's identity — so we never ingest, store, or log it.

import axios from 'axios';

const TIMEOUT_MS = 8000;

function get<T = any>(url: string, params: Record<string, unknown>, headers?: Record<string, string>) {
  return axios.get<T>(url, { params, headers, timeout: TIMEOUT_MS });
}

/** Output validation: provider payloads are untrusted — keep strings strings, capped. */
function capStr(v: unknown, max = 120): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

// ── Domain WHOIS / RDAP ─────────────────────────────────────────────────────

export interface WhoisInfo {
  created?: string;
  expires?: string;
  registrar?: string;
  isRegistered?: boolean;
  source: 'who-dat' | 'whoisjson';
}

/** Gated on WHOIS_LOOKUP_ENABLED so offline evals (which scrub it) skip the network. */
export function whoisEnabled(): boolean {
  return process.env.WHOIS_LOOKUP_ENABLED === '1';
}

/**
 * Normalized WHOIS/RDAP lookup. Primary: who-dat.as93.net (free, no key,
 * consistent shape across TLDs). Fallback: whoisjson.com when a key is set.
 */
export async function whoisLookup(domain: string): Promise<WhoisInfo | null> {
  if (!whoisEnabled() || !domain) return null;
  const host = domain.toLowerCase().replace(/^www\./, '');

  // who-dat — normalized RDAP with WHOIS fallback, single consistent shape.
  try {
    const { data } = await get(`https://who-dat.as93.net/v1/whois/${encodeURIComponent(host)}`, {});
    if (data && (data.dates || data.isRegistered !== undefined)) {
      return {
        created: data.dates?.created ?? undefined,
        expires: data.dates?.expires ?? undefined,
        registrar: capStr(data.registrar?.name),
        isRegistered: data.isRegistered,
        source: 'who-dat',
      };
    }
  } catch {
    /* fall through to whoisjson */
  }

  // whoisjson.com fallback (raw WHOIS text → pull the creation date out).
  const key = process.env.WHOISJSON_API_KEY;
  if (key) {
    try {
      const { data } = await get(
        'https://whoisjson.com/api/v1/whois',
        { domain: host },
        { Authorization: `TOKEN=${key}` }
      );
      const raw: string = typeof data?.data === 'string' ? data.data : JSON.stringify(data ?? {});
      const created = raw.match(/Creation Date:\s*([0-9T:\-Z.]+)/i)?.[1];
      const expires = raw.match(/(?:Registry Expiry Date|Expiration Date):\s*([0-9T:\-Z.]+)/i)?.[1];
      const registrar = capStr(raw.match(/Registrar:\s*(.+)/i)?.[1]?.trim());
      if (created || registrar) {
        return { created, expires, registrar, isRegistered: true, source: 'whoisjson' };
      }
    } catch {
      /* give up — caller treats null as "no WHOIS data" */
    }
  }
  return null;
}

// ── Email reputation (Abstract) ─────────────────────────────────────────────

export interface EmailReputation {
  isFreeEmail?: boolean;
  isDisposable?: boolean;
  isMxValid?: boolean;
  isDmarcEnforced?: boolean;
  isSpfStrict?: boolean;
  isRiskyTld?: boolean;
  domainAgeDays?: number;
  addressRisk?: 'low' | 'medium' | 'high';
  domainRisk?: 'low' | 'medium' | 'high';
  totalBreaches?: number;
}

export function emailReputationEnabled(): boolean {
  return Boolean(process.env.ABSTRACT_EMAIL_REPUTATION_KEY);
}

/** Abstract Email Reputation API. Person-name fields are intentionally discarded. */
export async function emailReputation(email: string): Promise<EmailReputation | null> {
  const key = process.env.ABSTRACT_EMAIL_REPUTATION_KEY;
  if (!key || !email) return null;
  try {
    const { data } = await get('https://emailreputation.abstractapi.com/v1/', {
      api_key: key,
      email,
    });
    if (!data || data.email_deliverability == null) return null;
    const q = data.email_quality ?? {};
    const dom = data.email_domain ?? {};
    const risk = data.email_risk ?? {};
    return {
      isFreeEmail: q.is_free_email ?? undefined,
      isDisposable: q.is_disposable ?? undefined,
      isMxValid: data.email_deliverability?.is_mx_valid ?? undefined,
      isDmarcEnforced: q.is_dmarc_enforced ?? undefined,
      isSpfStrict: q.is_spf_strict ?? undefined,
      isRiskyTld: dom.is_risky_tld ?? undefined,
      domainAgeDays: typeof dom.domain_age === 'number' ? dom.domain_age : undefined,
      addressRisk: risk.address_risk_status ?? undefined,
      domainRisk: risk.domain_risk_status ?? undefined,
      totalBreaches: data.email_breaches?.total_breaches ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── Phone intelligence (Abstract) ───────────────────────────────────────────

export interface PhoneIntel {
  isValid?: boolean;
  lineType?: string; // mobile | landline | voip | toll_free | ...
  isVoip?: boolean;
  carrier?: string;
  country?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  isDisposable?: boolean;
  isAbuseDetected?: boolean;
  totalBreaches?: number;
}

export function phoneIntelEnabled(): boolean {
  return Boolean(process.env.ABSTRACT_PHONE_KEY);
}

/**
 * Abstract Phone Intelligence API. The registered-owner name is deliberately
 * NOT read (POPIA minimality) — risk scoring only uses line type / reputation.
 * `country` defaults to ZA so local South African formats (e.g. 0XX...) resolve.
 */
export async function phoneIntelligence(phone: string, country = 'ZA'): Promise<PhoneIntel | null> {
  const key = process.env.ABSTRACT_PHONE_KEY;
  if (!key || !phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.replace(/\D/g, '').length < 7) return null;
  try {
    const { data } = await get('https://phoneintelligence.abstractapi.com/v1/', {
      api_key: key,
      phone: cleaned,
      country,
    });
    if (!data || data.phone_validation == null) return null;
    const carrier = data.phone_carrier ?? {};
    const risk = data.phone_risk ?? {};
    return {
      isValid: data.phone_validation?.is_valid ?? undefined,
      lineType: carrier.line_type ?? undefined,
      isVoip: data.phone_validation?.is_voip ?? carrier.line_type === 'voip',
      carrier: capStr(carrier.name),
      country: capStr(data.phone_location?.country_name, 60),
      riskLevel: risk.risk_level ?? undefined,
      isDisposable: risk.is_disposable ?? undefined,
      isAbuseDetected: risk.is_abuse_detected ?? undefined,
      totalBreaches: data.phone_breaches?.total_breaches ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── Company enrichment (Abstract) ───────────────────────────────────────────

export interface CompanyEnrichment {
  found: boolean;
  companyName?: string;
  yearFounded?: string;
  country?: string;
  employeeCount?: number | string;
  type?: string; // public | private
  industry?: string;
}

export function companyEnrichmentEnabled(): boolean {
  return Boolean(process.env.ABSTRACT_COMPANY_KEY);
}

/** Abstract Company Enrichment API — keyed on a domain. */
export async function companyEnrichment(domain: string): Promise<CompanyEnrichment | null> {
  const key = process.env.ABSTRACT_COMPANY_KEY;
  if (!key || !domain) return null;
  try {
    const { data } = await get('https://companyenrichment.abstractapi.com/v2', {
      api_key: key,
      domain: domain.toLowerCase().replace(/^www\./, ''),
    });
    if (!data) return null;
    return {
      found: Boolean(data.company_name),
      companyName: capStr(data.company_name),
      yearFounded: data.year_founded ?? undefined,
      country: capStr(data.country, 60),
      employeeCount: data.employee_count ?? undefined,
      type: data.type ?? undefined,
      industry: capStr(data.industry),
    };
  } catch {
    return null;
  }
}

// ── IP intelligence (Abstract) ──────────────────────────────────────────────

export interface IpIntel {
  isVpn?: boolean;
  isProxy?: boolean;
  isTor?: boolean;
  isHosting?: boolean;
  isAbuse?: boolean;
  country?: string;
  asnName?: string;
}

export function ipIntelEnabled(): boolean {
  return Boolean(process.env.ABSTRACT_IP_KEY);
}

/** Abstract IP Intelligence API — used on an email's originating (Received:) IP. */
export async function ipIntelligence(ip: string): Promise<IpIntel | null> {
  const key = process.env.ABSTRACT_IP_KEY;
  if (!key || !ip) return null;
  try {
    const { data } = await get('https://ip-intelligence.abstractapi.com/v1/', {
      api_key: key,
      ip_address: ip,
    });
    if (!data || !data.security) return null;
    return {
      isVpn: data.security.is_vpn ?? undefined,
      isProxy: data.security.is_proxy ?? undefined,
      isTor: data.security.is_tor ?? undefined,
      isHosting: data.security.is_hosting ?? undefined,
      isAbuse: data.security.is_abuse ?? undefined,
      country: capStr(data.location?.country, 60),
      asnName: capStr(data.asn?.name),
    };
  } catch {
    return null;
  }
}
