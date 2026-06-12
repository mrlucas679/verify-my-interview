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
        parts.push('cannot actually receive email — replies to it go nowhere, which no real employer would allow (technical: no MX records)');
      if (arr(dns.A).length === 0 && arr(dns.AAAA).length === 0)
        parts.push('has no website behind it');
      const age = whois.age_days;
      if (typeof age === 'number') {
        parts.push(
          age < 180
            ? `was registered only ${age} day${age === 1 ? '' : 's'} ago — very young for an employer`
            : `was registered ${age} days ago`
        );
      } else parts.push('hides or lacks a registration date');
      if (d.risky_tld === true) parts.push('uses a domain extension common in abuse');
      if (d.is_disposable === true) parts.push('belongs to a throwaway-email service');
      return `The domain ${domain} ${parts.slice(0, 3).join('; it ')}.`;
    }
    case 'detect_scam_patterns': {
      const n = typeof d.keyword_count === 'number' ? d.keyword_count : 0;
      const found = arr(d.found_keywords).map(str).filter(Boolean).slice(0, 4);
      return n > 0
        ? `Found ${n} known scam phrase${n === 1 ? '' : 's'} in the message (e.g. ${found.join(', ')}).`
        : 'No known scam phrases (payment demands, urgency, credential requests) in the message text itself.';
    }
    case 'lookup_company_registry': {
      const name = str(d.company_name) || str(d.name) || 'The company';
      if (d.registered === true || str(d.status).toLowerCase() === 'active') {
        return `${name} appears in the company registry${str(d.jurisdiction) ? ` (${str(d.jurisdiction)})` : ''}.`;
      }
      return `${name} could not be confirmed in official company registries.`;
    }
    case 'lookup_phone_intel': {
      const parts: string[] = [];
      if (d.valid === false) parts.push('the number is not a valid phone number');
      if (str(d.type).toLowerCase() === 'voip') parts.push('it is a VOIP (internet) line, not a fixed or mobile number');
      if (str(d.carrier)) parts.push(`carrier: ${str(d.carrier)}`);
      if (str(d.country)) parts.push(`registered in ${str(d.country)}`);
      return parts.length ? `Phone check: ${parts.slice(0, 3).join('; ')}.` : 'Phone number checked; nothing notable returned.';
    }
    case 'research_company_web': {
      const n = arr(d.results).length || (typeof d.result_count === 'number' ? d.result_count : 0);
      return n > 0
        ? `Public web search returned ${n} relevant result${n === 1 ? '' : 's'} (details below).`
        : 'Public web search found no independent mentions.';
    }
    default: {
      // Generic fallback: surface up to 3 primitive facts, never raw JSON.
      const facts = Object.entries(d)
        .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
        .slice(0, 3)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`);
      return facts.length ? `${facts.join('; ')}.` : 'Check completed; see trace for details.';
    }
  }
}
