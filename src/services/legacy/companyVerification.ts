import axios from 'axios';

export interface CompanyVerificationResult {
  company?: {
    name: string;
    regNum: string;
    country: string;
    registered: string;
    status: string;
    type: string;
    jurisdiction: string;
    officers?: any[];
  };
  checked?: boolean;
  providerUnavailable?: boolean;
  cached?: boolean;
  error?: string;
}

export class CompanyVerificationService {
  private apiKey: string;
  private cache = new Map<string, { data: CompanyVerificationResult; timestamp: number }>();
  private CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  private REQUEST_TIMEOUT_MS = 8_000;
  private MAX_CACHE_ENTRIES = 200;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENCORPORATES_API_KEY || '';
  }

  async verifyCompany(input: {
    name?: string;
    regNum?: string;
    country?: string;
  }, signal?: AbortSignal): Promise<CompanyVerificationResult> {
    const cacheKey = JSON.stringify(input);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { ...cached.data, cached: true };
    }

    try {
      if (!input.country) {
        return { error: 'Company registry skipped (country required)' };
      }

      // Primary: lookup by registration number
      if (input.regNum && input.country) {
        const result = await this.lookupByRegNum(input.regNum, input.country, signal);
        if (result) {
          this.setCache(cacheKey, result);
          return result;
        }
      }

      // Fallback: lookup by name
      if (input.name && input.country) {
        const result = await this.lookupByName(input.name, input.country, signal);
        if (result) {
          this.setCache(cacheKey, result);
          return result;
        }
      }

      return { checked: true };
    } catch (error) {
      return {
        providerUnavailable: true,
        error: error instanceof Error ? error.message : 'Company registry provider unavailable',
      };
    }
  }

  private async request<T>(
    url: string,
    params: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ status: number; data?: T }> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await axios.get<T>(url, {
          params,
          signal,
          timeout: this.REQUEST_TIMEOUT_MS,
          validateStatus: (status) => status < 500 || status === 429,
        });
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Company registry temporarily unavailable (${response.status})`);
          if (attempt < 2) {
            await this.wait(250 + Math.floor(Math.random() * 250), signal);
            continue;
          }
          throw lastError;
        }
        if (response.status >= 400 && response.status !== 404) {
          throw new Error(`Company registry request failed (${response.status})`);
        }
        return { status: response.status, data: response.data };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Company registry request failed');
        if (attempt === 2 || !this.isRetryable(error)) break;
        await this.wait(250 + Math.floor(Math.random() * 250), signal);
      }
    }
    throw lastError ?? new Error('Company registry provider unavailable');
  }

  private isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    return !status || status === 429 || status >= 500;
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error('Company registry request aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason instanceof Error ? signal.reason : new Error('Company registry request aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private setCache(cacheKey: string, data: CompanyVerificationResult): void {
    while (this.cache.size >= this.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { data, timestamp: Date.now() });
  }

  private async lookupByRegNum(
    regNum: string,
    country: string,
    signal?: AbortSignal
  ): Promise<CompanyVerificationResult | null> {
    try {
      const response = await this.request<any>(
        `https://api.opencorporates.com/v0.4/companies/${country}/${regNum}`,
        { api_token: this.apiKey },
        signal
      );
      if (response.status === 404 || response.status >= 400 || !response.data) return null;

      const company = response.data.data.company;
      return {
        company: {
          name: company.name,
          regNum: company.company_number,
          country: company.jurisdiction_code,
          registered: company.incorporation_date,
          status: company.company_status,
          type: company.company_type,
          jurisdiction: company.jurisdiction_code,
          officers: company.officers || [],
        },
        checked: true,
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error('Company registry lookup failed');
    }
  }

  private async lookupByName(
    name: string,
    country: string,
    signal?: AbortSignal
  ): Promise<CompanyVerificationResult | null> {
    try {
      const response = await this.request<any>(
        `https://api.opencorporates.com/v0.4/companies/search`,
        { q: name, jurisdiction_code: country, api_token: this.apiKey },
        signal
      );
      if (response.status >= 400 || !response.data) return null;

      if (response.data.data.companies.length === 0) {
        return null;
      }

      const company = response.data.data.companies[0].company;
      return {
        company: {
          name: company.name,
          regNum: company.company_number,
          country: company.jurisdiction_code,
          registered: company.incorporation_date,
          status: company.company_status,
          type: company.company_type,
          jurisdiction: company.jurisdiction_code,
        },
        checked: true,
      };
    } catch (error) {
      throw error instanceof Error ? error : new Error('Company registry lookup failed');
    }
  }
}
