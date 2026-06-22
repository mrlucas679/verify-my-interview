import * as dns from 'dns/promises';
import disposableDomains from '../../data/disposableDomains.json';
import {
  whoisLookup,
  emailReputation,
  companyEnrichment,
  ipIntelligence,
  EmailReputation,
  CompanyEnrichment,
  IpIntel,
} from '../../backend/verification/providers';

const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8'];
const MAX_DNS_RECORDS = 50;
const DNS_TIMEOUT_MS = 1_500;
const DNS_TRIES = 1;

export interface DomainVerificationResult {
  dns?: { MX: string[]; A: string[]; AAAA: string[] };
  whois?: {
    created?: string;
    expiry?: string;
    registrar?: string;
  };
  /** Reputation of an email address on this domain (Abstract), when available. */
  emailRep?: EmailReputation;
  /** Company that owns this domain (Abstract enrichment), when available. */
  company?: CompanyEnrichment;
  /** Reputation of the email's originating IP (Abstract), when available. */
  ipIntel?: IpIntel;
  geolocation?: {
    country?: string;
    city?: string;
  };
  disposable?: boolean;
  /** Free-mail provider (gmail/outlook/...) per email reputation. */
  isFree?: boolean;
  /** Domain uses a TLD associated with abuse, per email reputation. */
  riskyTld?: boolean;
  cached?: boolean;
  error?: string;
}

export interface DomainHealthInput {
  domain: string;
  /** A full email address on the domain — unlocks email-reputation enrichment. */
  email?: string;
  /** Originating IP (from email Received: headers) — unlocks IP intelligence. */
  senderIp?: string;
}

export class DomainVerificationService {
  private disposableDomainSet: Set<string>;
  private cache = new Map<string, { data: DomainVerificationResult; timestamp: number }>();
  private CACHE_TTL = 60 * 60 * 1000; // 1 hour
  private MAX_CACHE_ENTRIES = 500;

  constructor() {
    this.disposableDomainSet = new Set(disposableDomains as string[]);
  }

  async checkDomainHealth(
    input: string | DomainHealthInput,
    signal?: AbortSignal
  ): Promise<DomainVerificationResult> {
    const { domain, email, senderIp }: DomainHealthInput =
      typeof input === 'string' ? { domain: input } : input;
    const cacheKey = `${domain}|${email ?? ''}|${senderIp ?? ''}`;

    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { ...cached.data, cached: true };
    }

    const result: DomainVerificationResult = {};

    try {
      // Free, always-available checks run in parallel with the gated providers;
      // every provider returns null when unconfigured, so this is safe offline.
      const [dnsRecords, whois, emailRep, company, ipIntel] = await Promise.all([
        this.checkDNS(domain),
        whoisLookup(domain, signal),
        email ? emailReputation(email, signal) : Promise.resolve(null),
        companyEnrichment(domain, signal),
        senderIp ? ipIntelligence(senderIp, signal) : Promise.resolve(null),
      ]);

      result.dns = dnsRecords;
      if (whois) {
        result.whois = { created: whois.created, expiry: whois.expires, registrar: whois.registrar };
      }
      if (emailRep) {
        result.emailRep = emailRep;
        result.isFree = emailRep.isFreeEmail;
        result.riskyTld = emailRep.isRiskyTld;
      }
      if (company) result.company = company;
      if (ipIntel) result.ipIntel = ipIntel;

      // Disposable: local blocklist OR the reputation provider's verdict.
      result.disposable = this.disposableDomainSet.has(domain) || Boolean(emailRep?.isDisposable);

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private setCache(cacheKey: string, data: DomainVerificationResult): void {
    while (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
  }

  private async checkDNS(domain: string): Promise<{ MX: string[]; A: string[]; AAAA: string[] }> {
    try {
      const primaryResolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
      const fallbackResolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
      fallbackResolver.setServers(PUBLIC_DNS_SERVERS);
      const [mxRecords, aRecords, aaaaRecords] = await Promise.all([
        this.resolveWithFallback(() => primaryResolver.resolveMx(domain), () => fallbackResolver.resolveMx(domain)),
        this.resolveWithFallback(() => primaryResolver.resolve4(domain), () => fallbackResolver.resolve4(domain)),
        this.resolveWithFallback(() => primaryResolver.resolve6(domain), () => fallbackResolver.resolve6(domain)),
      ]);

      return {
        MX: mxRecords.map((r) => r.exchange),
        A: aRecords,
        AAAA: aaaaRecords,
      };
    } catch {
      return { MX: [], A: [], AAAA: [] };
    }
  }

  private async resolveWithFallback<T>(primary: () => Promise<T[]>, fallback: () => Promise<T[]>): Promise<T[]> {
    const primaryRecords = await primary().catch((): T[] => []);
    if (primaryRecords.length > 0) return primaryRecords.slice(0, MAX_DNS_RECORDS);
    const fallbackRecords = await fallback().catch((): T[] => []);
    return fallbackRecords.slice(0, MAX_DNS_RECORDS);
  }
}
