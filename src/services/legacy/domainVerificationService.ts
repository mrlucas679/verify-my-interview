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

  constructor() {
    this.disposableDomainSet = new Set(disposableDomains as string[]);
  }

  async checkDomainHealth(input: string | DomainHealthInput): Promise<DomainVerificationResult> {
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
        whoisLookup(domain),
        email ? emailReputation(email) : Promise.resolve(null),
        companyEnrichment(domain),
        senderIp ? ipIntelligence(senderIp) : Promise.resolve(null),
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

      this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async checkDNS(domain: string): Promise<{ MX: string[]; A: string[]; AAAA: string[] }> {
    try {
      const [mxRecords, aRecords, aaaaRecords] = await Promise.all([
        dns.resolveMx(domain).catch(() => []),
        dns.resolve4(domain).catch(() => []),
        dns.resolve6(domain).catch(() => []),
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
}
