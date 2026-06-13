// Evidence parser - extracts entities from unstructured evidence

import { Entities } from '../types/entities';

/** De-duplicate a list while preserving first-seen order. */
function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.length > 0)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanCompanyName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:Careers|Talent Acquisition|Recruiting|Recruitment|HR|Human Resources|Team)$/i, '')
    .replace(/[.,;:]+$/, '')
    .trim();
}

function titleCaseToken(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function companyFromDomain(domain: string): string | null {
  const host = domain.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const secondLevel = parts[parts.length - 2];
  if (
    !secondLevel ||
    secondLevel.length < 3 ||
    ['gmail', 'outlook', 'hotmail', 'yahoo', 'icloud', 'teams', 'linkedin'].includes(secondLevel)
  ) {
    return null;
  }
  return secondLevel
    .split(/[-_]+/)
    .filter((part) => part.length >= 2)
    .map(titleCaseToken)
    .join(' ');
}

function shouldKeepCompanyCandidate(candidate: string, source: 'contact' | 'company'): boolean {
  const clean = cleanCompanyName(candidate);
  if (clean.length < 3) return false;
  if (/^(?:candidate|team|recruiter|hiring manager|hr)$/i.test(clean)) return false;
  if (/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(clean)) return false;
  if (/^(?:january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(clean)) {
    return false;
  }
  // A single ordinary first name after "from" is usually the recruiter/contact,
  // not the company to research. Multi-word names and explicit company-context
  // captures still survive.
  if (source === 'contact' && /^[A-Z][a-z]{2,20}$/.test(clean)) return false;
  return true;
}

const KNOWN_BRANDS = [
  'Microsoft',
  'Amazon',
  'Google',
  'Meta',
  'Facebook',
  'Apple',
  'Netflix',
  'Shopify',
  'Stripe',
  'PayPal',
  'Tesla',
  'LinkedIn',
  'TikTok',
  'Standard Bank',
  'Capitec',
  'FNB',
  'Absa',
  'Nedbank',
  'Shoprite',
  'Pick n Pay',
  'Transnet',
  'Eskom',
  'Sasol',
  'MTN',
  'Vodacom',
  'Contoso',
];

function knownBrandsIn(evidence: string): string[] {
  return KNOWN_BRANDS.filter((brand) => {
    const pattern = escapeRegExp(brand).replace(/\\ /g, '\\s+');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(evidence);
  });
}

export class EvidenceParser {
  /**
   * Extract structured entities from unstructured evidence text
   */
  static parse(evidence: string): Entities {
    const entities: Entities = {
      companies: [],
      people: [],
      emails: [],
      domains: [],
      urls: [],
      phones: [],
      money_requests: [],
      job_titles: []
    };

    if (!evidence) {
      return entities;
    }

    // URLs (capture before domains so we can derive domains from them too)
    const urlMatches = evidence.match(/https?:\/\/[^\s)<>"']+/gi) || [];
    entities.urls = uniq(urlMatches.map((u) => u.replace(/[.,;]+$/, '')));

    // Emails
    const emailMatches =
      evidence.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
    entities.emails = uniq(emailMatches.map((e) => e.toLowerCase()));

    // Domains: from emails + from URLs
    const domainsFromEmails = entities.emails
      .map((e) => this.extractDomain(e))
      .filter((d): d is string => Boolean(d));
    const domainsFromUrls = entities.urls
      .map((u) => this.extractDomainFromUrl(u))
      .filter((d): d is string => Boolean(d));
    const bareDomainMatches = Array.from(
      evidence.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi)
    )
      .filter((match) => evidence[Math.max(0, match.index ?? 0) - 1] !== '@')
      .map((match) => match[0].toLowerCase());
    entities.domains = uniq([...domainsFromEmails, ...domainsFromUrls, ...bareDomainMatches]);

    // Phone numbers (require a leading + or at least 7 digits to reduce noise).
    // IP addresses in Received headers (198.51.100.72) match the digit pattern
    // too — exclude anything IP-shaped so we never burn a phone-intel lookup
    // on a mail-relay address.
    const phoneMatches =
      evidence.match(/\+?\d[\d().\-\s]{6,}\d/g) || [];
    entities.phones = uniq(
      phoneMatches
        .map((p) => p.trim())
        .filter((p) => (p.match(/\d/g) || []).length >= 7)
        .filter((p) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(p.replace(/\s/g, '')))
        .filter((p) => (p.match(/\./g) || []).length < 2)
    );

    // Money / payment requests
    const moneyMatches =
      evidence.match(
        /(?:\$|usd|eur|gbp|£|€)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\s?(?:dollars|usd|eur|gbp)\b/gi
      ) || [];
    const paymentPhrases =
      evidence.match(
        /\b(?:upfront|registration|training|equipment|onboarding|processing|activation)\s+fee\b/gi
      ) || [];
    entities.money_requests = uniq([
      ...moneyMatches.map((m) => m.trim()),
      ...paymentPhrases.map((p) => p.trim())
    ]);

    // Company names: capture phrases like "from Acme Corp" / "at Globex Inc"
    const companyMatches: string[] = [];
    const contactAtCompanyRegex =
      /\bfrom\s+[A-Z][a-z]{2,20}(?:\s+[A-Z][a-z]{2,20})?\s+at\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?)(?=[,.\n!?]|\s+(?:for|about|regarding|with|and|but|who|which)\b|$)/g;
    let contactAtMatch: RegExpExecArray | null;
    while ((contactAtMatch = contactAtCompanyRegex.exec(evidence)) !== null) {
      companyMatches.push(cleanCompanyName(contactAtMatch[1]));
    }

    const companyRegex =
      /(?:from|at|with|for|join|hired by|on behalf of|interview with|role at|position at)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?(?:\s(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|Group|Technologies|Solutions|Labs|Careers))?)\b/g;
    let companyMatch: RegExpExecArray | null;
    while ((companyMatch = companyRegex.exec(evidence)) !== null) {
      const prefix = companyMatch[0].slice(0, companyMatch[0].length - companyMatch[1].length).trim();
      const source = /^from$/i.test(prefix) ? 'contact' : 'company';
      if (shouldKeepCompanyCandidate(companyMatch[1], source)) {
        companyMatches.push(cleanCompanyName(companyMatch[1]));
      }
    }

    // Spoken/narrative phrasing: "the company name is Fake Identity",
    // "a company called Nimbus Talent" (voice transcripts use these forms).
    const namedRegex =
      /\bcompany(?:['’]s)?\s+(?:name\s+is|called|named)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?)(?=[,.\n!?]|\s+(?:and|but|so|they|the|said|says|asked|told|claimed|required|near|in|on|at|who|which)\b|$)/gim;
    let namedMatch: RegExpExecArray | null;
    while ((namedMatch = namedRegex.exec(evidence)) !== null) {
      companyMatches.push(cleanCompanyName(namedMatch[1]));
    }

    // Well-known impersonation targets count as the claimed employer wherever
    // they appear (subject lines, "the Amazon ... position"). Keep them first:
    // if a staffing shell and a famous employer both appear, the research pass
    // should not stop at the shell and miss the brand being impersonated.
    const companiesFromDomains = entities.domains
      .map(companyFromDomain)
      .filter((company): company is string => Boolean(company));
    entities.companies = uniq([...knownBrandsIn(evidence), ...companiesFromDomains, ...companyMatches]);

    return this.sanitize(entities);
  }

  /**
   * Validate and sanitize extracted entities
   */
  static sanitize(entities: Entities): Entities {
    // Entities are deliberately preserved intact: a scam recruiter's email,
    // domain, and phone ARE the fraud indicators the pipeline reasons over and
    // the network indexes (POPIA s11(1)(f) legitimate interest). Sensitive
    // identifiers of the data subject (SA ID / bank / card numbers) are NOT
    // entities and are stripped from free-text at the log/store boundary — see
    // backend/privacy/redaction.ts (used by POST /report and log masking).
    return entities;
  }

  /**
   * Extract domain from email address
   */
  static extractDomain(email: string): string | null {
    const match = email.match(/@([^\s]+)/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Extract domain from URL
   */
  static extractDomainFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}
