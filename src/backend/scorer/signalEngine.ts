// Deterministic signal engine.
//
// Derives structured, evidence-backed signals from REAL data: the verification
// tool results the investigator gathered, the parsed entities, and the raw
// evidence text. This is the system's actual detection logic — it always runs,
// independent of the LLM, so the score reflects real findings (no hardcoding).

import { Entities } from '../../types/entities';
import { StructuredSignal } from '../../types/report';
import { AgentToolCall } from '../agent/types';
import { EmailHeaderAnalysis } from '../../utils/emailHeaders';

/** Tools whose success counts toward verification coverage. */
export const CORE_TOOLS = ['lookup_company_registry', 'lookup_domain_rdap', 'detect_scam_patterns'];

/** Job-board aggregators that masquerade as the employer's application portal.
 *  Real employers recruit on their own ATS/careers domain, not these. Seeded
 *  from observed scam-ring infrastructure; extend as the network grows. */
const KNOWN_AGGREGATORS = new Set([
  'skillsdaily.co.za',
  'simply-jobs.co.za',
  'youthapplications.co.za',
  'careerjob.co.za',
  'careerjobza.co.za',
]);

/** Free website/blog hosts — never a legitimate corporate recruiting channel. */
const FREE_HOSTING = [
  'exblog.jp',
  'blogspot.com',
  'wordpress.com',
  'wixsite.com',
  'weebly.com',
  'sites.google.com',
  'over-blog.com',
  'webnode.page',
  'godaddysites.com',
  'square.site',
  'glitch.me',
  'firebaseapp.com',
  'netlify.app',
];

/** URL shorteners hide the true destination — a red flag in a job offer. */
export const URL_SHORTENERS = new Set([
  'bit.ly',
  'tinyurl.com',
  'shorturl.at',
  'cutt.ly',
  'rb.gy',
  't.co',
  'goo.gl',
  'ow.ly',
  'rebrand.ly',
  'is.gd',
  'buff.ly',
]);

/** Classify a domain as an unofficial application channel, or null if it looks legitimate. */
function channelKind(domain: string): 'aggregator' | 'free host' | 'link shortener' | null {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (KNOWN_AGGREGATORS.has(d)) return 'aggregator';
  if (URL_SHORTENERS.has(d)) return 'link shortener';
  if (FREE_HOSTING.some((h) => d === h || d.endsWith('.' + h))) return 'free host';
  return null;
}

function hostContainsToken(domain: string, token: string): boolean {
  return domain
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .includes(token.toLowerCase());
}

function isEmailDomain(domain: string, entities: Entities, headers?: EmailHeaderAnalysis): boolean {
  const d = domain.toLowerCase();
  return (
    entities.emails.some((email) => email.toLowerCase().endsWith(`@${d}`)) ||
    headers?.fromDomain === d ||
    headers?.replyToDomain === d
  );
}

function isOfficialCareersDomain(domain: string, companyName?: string): boolean {
  const token = companyName?.toLowerCase().match(/[a-z0-9]{3,}/)?.[0];
  if (!token) return false;
  const d = domain.toLowerCase();
  const labels = d.split('.');
  const sld = labels.length >= 2 ? labels[labels.length - 2] : d;
  const hasCareersLabel = labels.some((label) => /^(careers?|jobs?|work|talent)$/.test(label));
  return sld === token || (hasCareersLabel && hostContainsToken(d, token));
}

function isNegatedPaymentCue(evidence: string, cue: string): boolean {
  const haystack = evidence.toLowerCase();
  const needle = cue.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = haystack.slice(Math.max(0, idx - 50), idx);
  const after = haystack.slice(idx, Math.min(haystack.length, idx + needle.length + 50));
  return (
    /\b(?:no|not|never|without)\b[^.\n]{0,45}$/.test(before) ||
    /\b(?:not|required|charged|needed|payable)\b[^.\n]{0,35}\b(?:no|never)\b/.test(after) ||
    /\b(?:is|are)\s+not\s+(?:required|charged|payable|needed)\b/.test(after)
  );
}

function isCandidatePaidBenefitContext(evidence: string, matchText: string): boolean {
  const haystack = evidence.toLowerCase();
  const needle = matchText.toLowerCase();
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const window = haystack.slice(Math.max(0, idx - 60), Math.min(haystack.length, idx + needle.length + 80));
  return (
    /\b(?:you\s+will\s+be|you'll\s+be|will\s+be|be)\s+paid\b/.test(window) ||
    /\b(?:stipend|allowance|salary|per\s+(?:month|week|hour)|during\s+the\s+training\s+period)\b/.test(window)
  );
}

export function coverage(toolsUsed: AgentToolCall[]): number {
  const ok = new Set(
    toolsUsed.filter((t) => t.result.success && CORE_TOOLS.includes(t.tool)).map((t) => t.tool)
  );
  return ok.size / CORE_TOOLS.length;
}

function dedupeById(signals: StructuredSignal[]): StructuredSignal[] {
  const seen = new Set<string>();
  const out: StructuredSignal[] = [];
  for (const s of signals) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}

export function deriveSignals(
  evidence: string,
  entities: Entities,
  toolsUsed: AgentToolCall[],
  headers?: EmailHeaderAnalysis
): StructuredSignal[] {
  const signals: StructuredSignal[] = [];

  // --- Email header signals (when raw headers were submitted) -------------
  if (headers?.isRawEmail) {
    if (headers.replyToMismatch) {
      signals.push({
        id: 'reply_to_mismatch',
        label: 'Replies are routed to a different domain',
        category: 'red',
        points: 22,
        evidence: {
          source: 'email_headers',
          detail: `The sender uses ${headers.fromDomain}, but replies go to ${headers.replyToDomain}, a common spoofing setup`,
        },
      });
    }
    if (headers.dmarc === 'fail') {
      signals.push({
        id: 'dmarc_fail',
        label: 'Sender could not prove the email was authentic',
        category: 'red',
        points: 15,
        evidence: {
          source: 'email_headers',
          detail:
            'The email failed a standard proof-of-sender check, which is a strong sign the sender name may be faked',
        },
      });
    }
    if (headers.spf === 'fail' || headers.spf === 'softfail') {
      signals.push({
        id: 'spf_fail',
        label: 'Email came from a server the domain does not approve',
        category: 'red',
        points: 10,
        evidence: {
          source: 'email_headers',
          detail: 'This email came from a server that the domain does not authorize, which is common in spoofed mail',
        },
      });
    }
    if (headers.freeMailFrom && entities.companies.length > 0) {
      signals.push({
        id: 'freemail_corporate_claim',
        label: 'Corporate recruiter using a free-mail address',
        category: 'red',
        points: 12,
        evidence: {
          source: 'email_headers',
          detail: `Claims to represent ${entities.companies[0]} but sends from ${headers.fromDomain}`,
        },
      });
    }
    if (
      headers.dmarc === 'pass' &&
      headers.spf === 'pass' &&
      !headers.replyToMismatch &&
      !headers.freeMailFrom
    ) {
      signals.push({
        id: 'email_auth_pass',
        label: 'Email passes sender checks',
        category: 'positive',
        points: -8,
        evidence: {
          source: 'email_headers',
          detail: `The sender checks pass for ${headers.fromDomain}, and replies stay on the same domain`,
        },
      });
    }
  }
  const data = (tool: string): any => {
    const t = toolsUsed.find((x) => x.tool === tool && x.result.success);
    return t?.result.data;
  };
  const text = (evidence || '').toLowerCase();

  // --- Scam-pattern signals (local, always available) ---------------------
  const sp = data('detect_scam_patterns');
  if (sp) {
    const pd = sp.patterns_detected || {};
    const paymentCues = [
      ...(pd.payment_methods || []),
      ...entities.money_requests.filter((m) => /fee|upfront|gift\s?card|wire|crypto|bitcoin|deposit/i.test(m)),
    ].filter((cue) => !isNegatedPaymentCue(evidence, cue));
    // Demand phrasing in the evidence itself ("a compliance deposit of $200 is
    // required", "pay via USDT/Zelle"). "direct deposit" payroll language does
    // not match — the amount or payment rail must be tied to the demand.
    if (!paymentCues.length) {
      const demand = [
        /\b(?:deposit|fee)\s*(?:of\s*)?\$\s?\d[\d,.]*/i,
        /\$\s?\d[\d,.]*[^.\n]{0,30}\b(?:fee|deposit|upfront|is required)/i,
        /\b(?:pay|payment|send)\b[^.\n]{0,40}\b(?:usdt|btc|crypto(?:currency)?|gift\s?cards?|wire transfer|zelle|cash\s?app)/i,
        /\b(?:buy|purchase|pay\s+for|order)\b[^.\n]{0,70}\b(?:starter\s+(?:kit|pack)|uniform|equipment|training\s+materials?)\b/i,
      ]
        .map((re) => evidence.match(re))
        .find(Boolean);
      if (demand) paymentCues.push(demand[0].trim());
    }
    if (paymentCues.length) {
      signals.push({
        id: 'upfront_payment_request',
        label: 'Up-front payment requested',
        category: 'red',
        points: 40,
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Payment/fee language: ${paymentCues.slice(0, 4).join(', ')}`,
        },
      });
    }
    if ((pd.credential_requests || []).length) {
      signals.push({
        id: 'credential_request',
        label: 'Sensitive details requested before hire',
        category: 'red',
        points: 40,
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Requested: ${pd.credential_requests.slice(0, 4).join(', ')}`,
        },
      });
    }
    if ((pd.urgency_language || []).length) {
      signals.push({
        id: 'urgency_pressure',
        label: 'Urgency / pressure tactics',
        category: 'red',
        points: 10,
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Urgency cues: ${pd.urgency_language.slice(0, 4).join(', ')}`,
        },
      });
    }
    const deadlineCue = evidence.match(
      /\b(?:expires?|expire|deadline|within|by|before)\b[^.\n]{0,35}\b(?:\d{1,2}\s*(?:hours?|hrs?|days?)|today|tonight|24\s*hours?)\b|\b(?:act|reply|respond|complete|pay|send|sent|submit|transfer|deposit)\b[^.\n]{0,45}\b(?:today|tonight|now|immediately|within\s+\d{1,2}\s*(?:hours?|hrs?|days?))\b/i
    );
    if (deadlineCue && !signals.some((s) => s.id === 'urgency_pressure')) {
      signals.push({
        id: 'urgency_pressure',
        label: 'Urgency / pressure tactics',
        category: 'red',
        points: 10,
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Deadline pressure: "${deadlineCue[0].trim().slice(0, 90)}"`,
        },
      });
    }
    const score = sp.scam_score || 0;
    if (score >= 25) {
      signals.push({
        id: 'high_keyword_score',
        label: 'Message wording matches known scam patterns',
        category: 'red',
        points: Math.min(20, Math.round(score * 0.25)),
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Matched ${sp.keyword_count || 0} known scam wording indicator(s)`,
        },
      });
    }
  }

  // --- Domain / DNS signals ----------------------------------------------
  const dom = data('lookup_domain_rdap');
  if (dom) {
    const domain = typeof dom.domain === 'string' ? dom.domain.toLowerCase() : '';
    const emailDomain = domain ? isEmailDomain(domain, entities, headers) : false;
    const age = dom.whois_data?.age_days;
    if (typeof age === 'number') {
      if (age < 90) {
        signals.push({
          id: 'recently_registered_domain',
          label: `Recruiter domain registered ${age} days ago`,
          category: 'red',
          points: 20,
          evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} created very recently (${age}d)` },
        });
      } else if (age < 180) {
        signals.push({
          id: 'newish_domain',
          label: `Recruiter domain only ${age} days old`,
          category: 'red',
          points: 10,
          evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} is young (${age}d)` },
        });
      } else if (age > 730) {
        signals.push({
          id: 'established_domain',
          label: `Established domain (~${Math.round(age / 365)}y old)`,
          category: 'positive',
          points: -10,
          evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} registered ${age}d ago` },
        });
      }
    }
    if (isOfficialCareersDomain(domain, entities.companies[0])) {
      signals.push({
        id: 'official_domain_match',
        label: 'Domain matches the claimed employer',
        category: 'positive',
        points: -10,
        evidence: {
          source: 'lookup_domain_rdap',
          detail: `${dom.domain} matches ${entities.companies[0]}'s employer/careers domain pattern`,
        },
      });
    }
    if (dom.is_disposable) {
      signals.push({
        id: 'disposable_email_domain',
        label: 'Disposable / temporary email domain',
        category: 'red',
        points: 20,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} is a known disposable provider` },
      });
    }
    const mx = Array.isArray(dom.dns_records?.MX) ? dom.dns_records.MX : [];
    const mxProviderValid = dom.mx_valid === true;
    if (emailDomain && mx.length === 0 && !mxProviderValid) {
      signals.push({
        id: 'no_mx_records',
        label: 'Recruiter domain cannot receive email',
        category: 'red',
        points: 12,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} has no mail records, which is unusual for a real employer` },
      });
    } else if (emailDomain) {
      const detail = mx.length
        ? `${dom.domain} has ${mx.length} mail record(s)`
        : `${dom.domain} mail delivery was validated by the email reputation provider`;
      signals.push({
        id: 'has_mx',
        label: 'Domain can receive email',
        category: 'positive',
        points: -5,
        evidence: { source: 'lookup_domain_rdap', detail },
      });
    }
    // Real reputation verdicts (only present when email-reputation enrichment ran).
    if (dom.risky_tld === true) {
      signals.push({
        id: 'risky_tld_domain',
        label: 'Domain uses a high-risk TLD',
        category: 'red',
        points: 12,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} sits on a TLD associated with abuse` },
      });
    }
    if (dom.domain_risk === 'high') {
      signals.push({
        id: 'email_flagged_high_risk',
        label: 'Recruiter domain flagged high-risk',
        category: 'red',
        points: 18,
        evidence: {
          source: 'lookup_domain_rdap',
          detail: `An email-reputation service rates the whole domain ${dom.domain} as high-risk for fraud`,
        },
      });
    } else if (dom.address_risk === 'high') {
      // Address-level risk on an otherwise clean domain often just means the
      // mailbox is unknown/new — real signal, but weaker than a bad domain,
      // and it must not smear an established employer's domain.
      signals.push({
        id: 'email_flagged_high_risk',
        label: 'Recruiter mailbox flagged risky',
        category: 'red',
        points: 10,
        evidence: {
          source: 'lookup_domain_rdap',
          detail: `An email-reputation service flags this specific mailbox as risky (the ${dom.domain} domain itself is not flagged)`,
        },
      });
    }
    const ip = dom.ip_intel;
    if (ip && (ip.isProxy || ip.isTor || ip.isHosting || ip.isAbuse)) {
      const flags = [
        ip.isProxy && 'proxy',
        ip.isTor && 'Tor',
        ip.isHosting && 'hosting/datacenter',
        ip.isAbuse && 'known-abuse',
      ].filter(Boolean);
      signals.push({
        id: 'proxy_hosting_sender_ip',
        label: 'Email sent through an anonymizing / datacenter IP',
        category: 'red',
        points: 12,
        evidence: {
          source: 'lookup_domain_rdap',
          detail: `The sending server appears to be ${flags.join(', ')}, which is atypical for a real employer's mail server`,
        },
      });
    }
  }

  // --- Recruiter phone-number intelligence (Abstract Phone) ---------------
  const phone = data('lookup_phone_intel');
  if (phone) {
    if (phone.is_voip === true) {
      signals.push({
        id: 'voip_recruiter_number',
        label: 'Recruiter number is internet-based',
        category: 'red',
        points: 10,
        evidence: {
          source: 'lookup_phone_intel',
          detail: 'The main contact number is internet-based, which can be easier to discard than a normal business line',
        },
      });
    }
    if (phone.risk_level === 'high' || phone.is_abuse_detected === true || phone.is_disposable === true) {
      const why = [
        phone.risk_level === 'high' && 'rated high-risk',
        phone.is_abuse_detected && 'linked to reported abuse',
        phone.is_disposable && 'a disposable number',
      ].filter(Boolean);
      signals.push({
        id: 'high_risk_phone',
        label: 'Recruiter phone number flagged',
        category: 'red',
        points: 18,
        evidence: { source: 'lookup_phone_intel', detail: `Phone-intelligence: ${why.join(', ')}` },
      });
    }
  }

  // --- Company registry signals ------------------------------------------
  const comp = data('lookup_company_registry');
  if (comp) {
    if (comp.registered) {
      const active = String(comp.status || '').toUpperCase() === 'ACTIVE';
      signals.push({
        id: 'company_registered',
        label: active ? 'Company appears registered and active' : 'Company appears in a registry',
        category: 'positive',
        points: active ? -15 : -8,
        evidence: {
          source: 'lookup_company_registry',
          detail: `${comp.company_name}: ${comp.status || 'registered'}${comp.jurisdiction ? `, ${comp.jurisdiction}` : ''}`,
        },
      });
    } else {
      signals.push({
        id: 'company_not_in_registry',
        label: 'Company not found in official registry',
        category: 'red',
        points: 12,
        evidence: {
          source: 'lookup_company_registry',
          detail: `No registry match for "${entities.companies[0] || 'the company'}"`,
        },
      });
    }
  }

  // --- Web / OSINT research signals --------------------------------------
  const research = data('research_company_web');
  if (research) {
    const scamMentions = research.scam_mentions ?? research.scamMentions;
    const officialListing = research.official_listing_found ?? research.officialListingFound;
    const scamUrl = research.scam_mention_url ?? research.scamMentionUrl;
    const listingUrl = research.official_listing_url ?? research.officialListingUrl;

    if (scamMentions) {
      signals.push({
        id: 'web_scam_warnings',
        label: 'Public scam warnings found online',
        category: 'red',
        points: 18,
        evidence: {
          source: 'research_company_web',
          detail: `Public search found scam, fraud, or complaint results that mention "${entities.companies[0] || 'this company'}"${scamUrl ? ` (${scamUrl})` : ''}`,
        },
      });
    }
    if (officialListing) {
      signals.push({
        id: 'official_listing',
        label: 'Official job listing found online',
        category: 'positive',
        points: -10,
        evidence: {
          source: 'research_company_web',
          detail: `A matching careers/job listing was found on an official employer domain or a recognised job board${listingUrl ? ` (${listingUrl})` : ''}`,
        },
      });
    }
  }

  // --- Impersonation / look-alike domain (computed from entities) --------
  const companyToken = (entities.companies[0] || '').toLowerCase().match(/[a-z]{3,}/)?.[0];
  if (companyToken) {
    for (const d of entities.domains) {
      const labels = d.split('.');
      const sld = labels.length >= 2 ? labels[labels.length - 2] : d;
      if (sld.includes(companyToken) && sld !== companyToken) {
        signals.push({
          id: 'lookalike_domain',
          label: 'Look-alike / impersonation domain',
          category: 'red',
          points: 22,
          evidence: {
            source: 'entities',
            detail: `"${d}" mimics ${entities.companies[0]} but is not its official domain`,
          },
        });
        break;
      }
    }
  }

  // --- South African fee / credential cues (locale-aware) -----------------
  // The entity parser is $/£/€-centric and keys on US credential names; SA
  // scams quote rand and ask for ID/SARS/banking documents. Detect both here
  // so a rand-denominated "induction fee" scores like its USD twin, and the
  // demand for ID/banking proof before any hire registers as a credential ask.
  const has = (id: string) => signals.some((s) => s.id === id);

  const feeCue =
    evidence.match(
      /\b(?:medical|induction|registration|admin(?:istration)?|application|processing|joining|training|activation|onboarding)\s+(?:and\s+[a-z]+\s+)?fees?\b/i
    ) ||
    evidence.match(/\b(?:fee|deposit|pay(?:ment)?)\b[^.\n]{0,25}\bR\s?\d[\d,. ]*/i) ||
    evidence.match(/\bR\s?\d[\d,. ]*[^.\n]{0,25}\b(?:fee|deposit|non-?refundable|to start|to begin)\b/i);
  if (feeCue && !isNegatedPaymentCue(evidence, feeCue[0]) && !has('upfront_payment_request')) {
    signals.push({
      id: 'upfront_payment_request',
      label: 'Up-front payment requested',
      category: 'red',
      points: 40,
      evidence: { source: 'text', detail: `Fee/payment demand: "${feeCue[0].trim().slice(0, 80)}"` },
    });
  }

  const credentialCues = Array.from(
    new Set(
      (
        evidence.match(
          /\b(?:id\s?(?:copy|number|document)|copy of (?:your )?id|sars letter|proof of (?:banking|bank|residence|address)|bank(?:ing)? details|account number|online[-\s]?banking username|login credentials|one[-\s]?time\s+(?:pin|code|passcode)|otp|app approval code|banking app approval code)\b/gi
        ) || []
      ).map((m) => m.toLowerCase())
    )
  );
  // "Bring certified copies to your interview" is normal SA practice — only a
  // request to *transmit* documents before a verified hire is a red flag.
  const transmitContext = /\b(?:send|e-?mail|whats?app|submit|upload|forward|provide|share|attach|drop)\b/i.test(
    text
  );
  if (credentialCues.length && transmitContext && !has('credential_request')) {
    signals.push({
      id: 'credential_request',
      label: 'Sensitive details requested before hire',
      category: 'red',
      points: 40,
      evidence: {
        source: 'text',
        detail: `Requested before any verified hire: ${credentialCues.slice(0, 4).join(', ')}`,
      },
    });
  }

  // --- Money-mule / payment-routing request --------------------------------
  // A job that asks the candidate to use a personal account to receive and
  // forward customer/company funds is not a normal payroll step. It exposes the
  // user to fraud and laundering risk even if no fee is requested.
  const moneyMuleCue =
    /\b(?:receive|accept|process|deposit|route)\b[^.\n]{0,70}\b(?:customer|client|company|refunds?|payments?|money|funds?)\b[^.\n]{0,90}\b(?:personal|your|own)\s+bank\s+account\b/i.test(
      evidence
    ) ||
    /\b(?:personal|your|own)\s+bank\s+account\b[^.\n]{0,100}\b(?:forward|transfer|send|wire|route)\b[^.\n]{0,60}\b(?:funds?|money|payments?|refunds?|rest)\b/i.test(
      evidence
    );
  if (moneyMuleCue) {
    signals.push({
      id: 'money_mule_request',
      label: 'Asked to move money through a personal bank account',
      category: 'red',
      points: 45,
      evidence: {
        source: 'text',
        detail:
          'The role asks the candidate to receive or forward customer/company funds through a personal bank account',
      },
    });
  }

  // --- Unofficial application channel (aggregator / free host / shortener) -
  // A named employer whose application channel is a job-aggregator portal, a
  // free website host, or a shortened link — the signature of the template ring
  // that impersonates real brands. A registered company name does NOT make the
  // channel legitimate; this is the counterweight to `company_registered`.
  if (entities.companies.length) {
    const flagged = entities.domains
      .map((d) => ({ d, kind: channelKind(d) }))
      .find((x) => x.kind);
    if (flagged) {
      signals.push({
        id: 'unofficial_application_channel',
        label: 'Application routed through an unofficial channel',
        category: 'red',
        points: 22,
        evidence: {
          source: 'entities',
          detail: `Claims ${entities.companies[0]} but applications go to ${flagged.d} (${flagged.kind}), not an official employer domain`,
        },
      });
    }
  }

  // --- Training/registration fee in narrative form --------------------------
  // Victims describing a scam in their own words say "people paid 6,000 for
  // training" — no currency symbol, no "fee" keyword, so the written-scam
  // pattern list misses it. Catch spoken/narrative fee phrasing directly.
  const narrativeFee =
    /\b(?:paid|pay|paying|payment\s+of|asked\s+(?:me|us|them)?\s*(?:to\s+pay|for))\s+(?:R\s?)?\d[\d\s,.]{1,9}\s*(?:rand\b|for\b|to\b)?[^.\n]{0,30}\b(?:training|registration|onboarding|uniform|starter\s+pack|admin(?:istration)?\s+fee|equipment)/i;
  const feeBeforeAmount =
    /\b(?:asked\s+(?:me|us|them)?\s*(?:to\s+pay|for)|had\s+to\s+pay|needed\s+to\s+pay|must\s+pay|pay)\b[^.\n]{0,60}\b(?:training|registration|onboarding|uniform|starter\s+pack|starter\s+kit|admin(?:istration)?|equipment)\s+(?:fee|deposit|cost|payment|materials?)\b[^.\n]{0,35}\b(?:of\s*)?(?:R\s?)?\d[\d\s,.]{1,9}/i;
  const labelledFee =
    /\b(?:training|registration|onboarding|uniform|starter\s+pack|starter\s+kit|admin(?:istration)?|equipment)\s+(?:fee|deposit|cost|payment|materials?)\b[^.\n]{0,35}\b(?:of\s*)?(?:R\s?)?\d[\d\s,.]{1,9}/i;
  const narrativeFeeMatch =
    evidence.match(narrativeFee) || evidence.match(feeBeforeAmount) || evidence.match(labelledFee);
  if (narrativeFeeMatch && !isCandidatePaidBenefitContext(evidence, narrativeFeeMatch[0])) {
    signals.push({
      id: 'training_fee_narrative',
      label: 'Money asked for training / registration',
      category: 'red',
      points: 20,
      evidence: {
        source: 'detect_scam_patterns',
        detail:
          'The account describes people paying for training, registration, or equipment to get the job. Legitimate employers do not charge candidates',
      },
    });
  }

  // --- SMS reply-bait (smishing stage one) ---------------------------------
  // A short job-offer text that asks the victim to reply ("reply YES", "type
  // YES") carries no links or entities on purpose: the reply confirms a live,
  // engaged number and triggers the real scam in a follow-up message. The
  // absence of verifiable detail is the design, so it must score on its own.
  const replyBait =
    evidence.length < 320 &&
    /\b(job|interview|position|role|hiring|recruit|salary|offer|vacancy|earn|cv)\b/i.test(text) &&
    /\b(reply|respond|text|type|send)\b[^.!?\n]{0,24}\b(yes|interested|confirm|start)\b/i.test(
      text
    );
  if (replyBait) {
    signals.push({
      id: 'sms_reply_bait',
      label: 'Reply-bait SMS pattern',
      category: 'red',
      points: 18,
      evidence: {
        source: 'detect_scam_patterns',
        detail:
          'Short job text asks you to reply, such as "reply YES". Replying confirms your number is active and can trigger a follow-up scam message',
      },
    });
  }

  // --- WhatsApp / personal-number-only application ------------------------
  // No email, no website — apply only via a personal mobile / WhatsApp. Common
  // to informal hiring, so it only nudges; it compounds with fee/credential cues.
  const whatsappOnly =
    /\bwhats?app\b/i.test(text) &&
    entities.emails.length === 0 &&
    entities.urls.length === 0 &&
    (entities.phones.length > 0 || /\b0\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/.test(evidence));
  if (whatsappOnly) {
    signals.push({
      id: 'whatsapp_only_application',
      label: 'Application only via WhatsApp / personal number',
      category: 'red',
      points: 10,
      evidence: {
        source: 'text',
        detail: 'Hiring handled entirely over WhatsApp with no company email or careers page',
      },
    });
  }

  // --- Offer with no interview step --------------------------------------
  if (
    /\b(hired|offer|congratulations|selected|position)\b/.test(text) &&
    !/\binterview\b/.test(text) &&
    /\b(start|onboard|pay|fee|deposit)\b/.test(text)
  ) {
    signals.push({
      id: 'no_interview_offer',
      label: 'Job offer with no interview step',
      category: 'red',
      points: 8,
      evidence: {
        source: 'text',
        detail: 'Offer or onboarding language appears without an interview step, which is atypical for legitimate hiring',
      },
    });
  }

  return dedupeById(signals);
}
