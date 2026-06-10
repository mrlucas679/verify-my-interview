// Data structures for entities extracted from evidence

export interface Entities {
  companies: string[];
  people: string[];
  emails: string[];
  domains: string[];
  urls: string[];
  phones: string[];
  money_requests: string[];
  job_titles: string[];
  /** Reply-To address when the evidence is a raw email with headers. */
  reply_to?: string;
  /** Originating sender IP extracted from Received: headers. */
  sender_ip?: string;
}

export interface CompanyInfo {
  found: boolean;
  domain?: string;
  founded?: number;
  legal_name?: string;
  country?: string;
}

export interface DomainInfo {
  created: Date;
  updated?: Date;
  expires?: Date;
  registrant?: string;
  registrar?: string;
}

export interface DNSRecords {
  mx_records: string[];
  spf_record?: string;
  dmarc_record?: string;
}

export interface URLReputation {
  phishing_risk: number; // 0-100
  malware_risk: number; // 0-100
  reputation_score: number; // 0-100
  reported_as: string[];
}

export interface ScamPatterns {
  upfront_payment: boolean;
  impersonation: boolean;
  urgency: boolean;
  identity_request: boolean;
  grammar_issues: number; // 0-1 confidence
  suspicious_phrases: string[];
}

export interface WebSearchResult {
  source: string;
  url: string;
  title: string;
  snippet: string;
}

export interface ReputationSearchResults {
  results: WebSearchResult[];
}
