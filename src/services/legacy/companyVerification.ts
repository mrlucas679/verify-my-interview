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
  cached?: boolean;
  error?: string;
}

export class CompanyVerificationService {
  private apiKey: string;
  private cache = new Map<string, { data: CompanyVerificationResult; timestamp: number }>();
  private CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENCORPORATES_API_KEY || '';
  }

  async verifyCompany(input: {
    name?: string;
    regNum?: string;
    country?: string;
  }): Promise<CompanyVerificationResult> {
    const cacheKey = JSON.stringify(input);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return { ...cached.data, cached: true };
    }

    try {
      // Primary: lookup by registration number
      if (input.regNum && input.country) {
        const result = await this.lookupByRegNum(input.regNum, input.country);
        if (result) {
          this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
          return result;
        }
      }

      // Fallback: lookup by name
      if (input.name && input.country) {
        const result = await this.lookupByName(input.name, input.country);
        if (result) {
          this.cache.set(cacheKey, { data: result, timestamp: Date.now() });
          return result;
        }
      }

      return { error: 'Company not found in registry' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async lookupByRegNum(regNum: string, country: string): Promise<CompanyVerificationResult | null> {
    try {
      const response = await axios.get(
        `https://api.opencorporates.com/v0.4/companies/${country}/${regNum}`,
        { params: { api_token: this.apiKey } }
      );

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
      };
    } catch {
      return null;
    }
  }

  private async lookupByName(name: string, country: string): Promise<CompanyVerificationResult | null> {
    try {
      const response = await axios.get(
        `https://api.opencorporates.com/v0.4/companies/search`,
        { params: { q: name, jurisdiction_code: country, api_token: this.apiKey } }
      );

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
      };
    } catch {
      return null;
    }
  }
}
