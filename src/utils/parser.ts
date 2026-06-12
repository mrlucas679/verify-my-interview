// Evidence parser - extracts entities from unstructured evidence

import { Entities } from '../types/entities';

/** De-duplicate a list while preserving first-seen order. */
function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter((v) => v && v.length > 0)));
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
    entities.domains = uniq([...domainsFromEmails, ...domainsFromUrls]);

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
    const companyRegex =
      /(?:from|at|with|for|join|hired by|on behalf of)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?(?:\s(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|Group|Technologies|Solutions|Labs))?)\b/g;
    let companyMatch: RegExpExecArray | null;
    while ((companyMatch = companyRegex.exec(evidence)) !== null) {
      companyMatches.push(companyMatch[1].trim());
    }

    // Spoken/narrative phrasing: "the company name is Fake Identity",
    // "a company called Nimbus Talent" (voice transcripts use these forms).
    const namedRegex =
      /\bcompany(?:['’]s)?\s+(?:name\s+is|called|named)\s+([A-Z][A-Za-z0-9&.\- ]{1,40}?)(?=[,.\n!?]|\s+(?:and|but|so|they|the|near|in|on|at|who|which)\b|$)/gim;
    let namedMatch: RegExpExecArray | null;
    while ((namedMatch = namedRegex.exec(evidence)) !== null) {
      companyMatches.push(namedMatch[1].trim());
    }

    // Well-known impersonation targets count as the claimed employer wherever
    // they appear (subject lines, "the Amazon ... position") — scammers name
    // the brand without "at/from", so preposition patterns miss them.
    const KNOWN_BRANDS = [
      'Microsoft', 'Amazon', 'Google', 'Meta', 'Facebook', 'Apple', 'Netflix',
      'Shopify', 'Stripe', 'PayPal', 'Tesla', 'LinkedIn', 'TikTok',
      'Standard Bank', 'Capitec', 'FNB', 'Absa', 'Nedbank', 'Shoprite',
      'Pick n Pay', 'Transnet', 'Eskom', 'Sasol', 'MTN', 'Vodacom',
    ];
    if (companyMatches.length === 0) {
      for (const brand of KNOWN_BRANDS) {
        if (new RegExp(`\\b${brand.replace(/ /g, '\\s+')}\\b`).test(evidence)) {
          companyMatches.push(brand);
          break; // first brand mentioned is the claimed employer
        }
      }
    }
    entities.companies = uniq(companyMatches);

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
