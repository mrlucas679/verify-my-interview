// Turns raw verification-tool output into one plain-English sentence for the
// user-facing report. Raw JSON stays in the developer trace; reports must read
// like an investigator wrote them (user feedback 2026-06-11: "raw answers from
// the API" are unreadable).

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec {
  return typeof v === 'object' && v !== null ? (v as Rec) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** One readable sentence (≤ ~200 chars) summarizing a tool result. */
export function summarizeToolResult(tool: string, data: unknown): string {
  const d = rec(data);
  switch (tool) {
    case 'lookup_domain_rdap': {
      const domain = str(d.domain) || 'domain';
      const dns = rec(d.dns_records);
      const whois = rec(d.whois_data);
      const parts: string[] = [];
      if (arr(dns.MX).length === 0)
        parts.push('cannot receive email because it has no mail records');
      if (arr(dns.A).length === 0 && arr(dns.AAAA).length === 0)
        parts.push('does not appear to have a website behind it');
      const age = whois.age_days;
      if (typeof age === 'number') {
        parts.push(
          age < 180
            ? `was registered only ${age} day${age === 1 ? '' : 's'} ago, which is unusually new for an employer`
            : `was registered ${age} days ago`
        );
      } else parts.push('does not show a reliable public registration date');
      if (d.risky_tld === true) parts.push('uses a domain extension common in abuse');
      if (d.is_disposable === true) parts.push('belongs to a throwaway-email service');
      return `The domain ${domain} ${parts.slice(0, 3).join('; it ')}.`;
    }
    case 'detect_scam_patterns': {
      const n = typeof d.keyword_count === 'number' ? d.keyword_count : 0;
      const found = arr(d.found_keywords).map(str).filter(Boolean).slice(0, 4);
      return n > 0
        ? `The message contains ${n} phrase${n === 1 ? '' : 's'} commonly seen in job scams, including ${found.join(', ')}.`
        : 'The wording did not contain common scam phrases such as payment demands, pressure, or credential requests.';
    }
    case 'lookup_company_registry': {
      const name = str(d.company_name) || str(d.name) || 'The company';
      if (d.registered === true || str(d.status).toLowerCase() === 'active') {
        return `${name} appears in an official company registry${str(d.jurisdiction) ? ` (${str(d.jurisdiction)})` : ''}.`;
      }
      return `${name} was not confirmed in the company registry checks available to this investigation.`;
    }
    case 'lookup_phone_intel': {
      // Field names mirror the adapter output (phoneIntel.adapter.ts): is_valid,
      // line_type, is_voip, carrier, country, risk_level, is_abuse_detected.
      const parts: string[] = [];
      if (d.is_valid === false) parts.push('the number is not a valid phone number');
      if (d.is_voip === true || str(d.line_type).toLowerCase() === 'voip')
        parts.push('it is an internet-based (VOIP) line, which can be harder to trace');
      if (str(d.risk_level).toLowerCase() === 'high' || d.is_abuse_detected === true)
        parts.push('it is flagged as high-risk or linked to reported abuse');
      if (str(d.carrier)) parts.push(`carrier: ${str(d.carrier)}`);
      if (str(d.country)) parts.push(`registered in ${str(d.country)}`);
      return parts.length ? `Phone check: ${parts.slice(0, 3).join('; ')}.` : 'The phone check did not return a clear warning sign.';
    }
    case 'research_company_web': {
      const n = arr(d.results).length || (typeof d.result_count === 'number' ? d.result_count : 0);
      return n > 0
        ? `Public web search found ${n} relevant result${n === 1 ? '' : 's'} for review.`
        : 'Public web search did not find independent mentions for this company or offer.';
    }
    default: {
      // Generic fallback: surface up to 3 primitive facts, never raw JSON.
      const facts = Object.entries(d)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .slice(0, 3)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`);
      return facts.length ? `${facts.join('; ')}.` : 'The check completed, but did not return a user-facing finding.';
    }
  }
}
