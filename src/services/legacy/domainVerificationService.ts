import axios from 'axios';
import * as dns from 'dns/promises';
import disposableDomains from '../../data/disposableDomains.json';

export interface DomainVerificationResult {
  dns?: { MX: string[]; A: string[]; AAAA: string[] };
  whois?: {
    created?: string;
    expiry?: string;
    registrar?: string;
  };
  geolocation?: {
    country?: string;
    city?: string;
  };
  disposable?: boolean;
  cached?: boolean;
  error?: string;
}

export class DomainVerificationService {
  private whoisApiKey: string;
  private abstractApiKey: string;
  private disposableDomainSet: Set<string>;
  private cache = new Map<string, { data: DomainVerificationResult; timestamp: number }>();
  private CACHE_TTL = 60 * 60 * 1000; // 1 hour

  constructor(whoisApiKey?: string, abstractApiKey?: string) {
    this.whoisApiKey = whoisApiKey || process.env.WHOIS_XML_API_KEY || '';
    this.abstractApiKey = abstractApiKey || process.env.ABSTRACT_API_KEY || '';
    this.disposableDomainSet = new Set(disposableDomains as string[]);
  }

  async checkDomainHealth(domain: string): Promise<DomainVerificationResult> {
    const cacheKey = domain;

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { ...cached.data, cached: true };
    }

    const result: DomainVerificationResult = {};

    try {
      // DNS checks
      result.dns = await this.checkDNS(domain);

      // WHOIS data
      result.whois = await this.checkWHOIS(domain);

      // Geolocation
      result.geolocation = await this.getGeolocation(domain);

      // Disposable email check
      result.disposable = this.disposableDomainSet.has(domain);

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

  private async checkWHOIS(domain: string): Promise<{ created?: string; expiry?: string; registrar?: string } | undefined> {
    try {
      const response = await axios.get(`https://www.whoisxmlapi.com/api/v1`, {
        params: {
          apiKey: this.whoisApiKey,
          domain,
          outputFormat: 'json',
        },
      });

      const data = response.data;
      return {
        created: data.WhoisRecord?.createdDate,
        expiry: data.WhoisRecord?.expiresDate,
        registrar: data.WhoisRecord?.registrar?.name,
      };
    } catch {
      return undefined;
    }
  }

  private async getGeolocation(domain: string): Promise<{ country?: string; city?: string } | undefined> {
    try {
      const response = await axios.get(`https://ipgeolocation.abstractapi.com/v1/`, {
        params: {
          api_key: this.abstractApiKey,
          domain,
        },
      });

      return {
        country: response.data.country,
        city: response.data.city,
      };
    } catch {
      return undefined;
    }
  }
}
