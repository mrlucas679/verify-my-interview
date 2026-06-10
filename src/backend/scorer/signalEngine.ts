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
          detail: `From ${headers.fromDomain} but Reply-To ${headers.replyToDomain} — a classic spoofing setup`,
        },
      });
    }
    if (headers.dmarc === 'fail') {
      signals.push({
        id: 'dmarc_fail',
        label: 'Sender failed DMARC authentication',
        category: 'red',
        points: 15,
        evidence: { source: 'email_headers', detail: 'Authentication-Results: dmarc=fail' },
      });
    }
    if (headers.spf === 'fail' || headers.spf === 'softfail') {
      signals.push({
        id: 'spf_fail',
        label: 'Sender failed SPF authentication',
        category: 'red',
        points: 10,
        evidence: { source: 'email_headers', detail: `Authentication-Results: spf=${headers.spf}` },
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
        label: 'Email passes sender authentication',
        category: 'positive',
        points: -8,
        evidence: {
          source: 'email_headers',
          detail: `SPF and DMARC pass for ${headers.fromDomain}; Reply-To consistent`,
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
    ];
    // Demand phrasing in the evidence itself ("a compliance deposit of $200 is
    // required", "pay via USDT/Zelle"). "direct deposit" payroll language does
    // not match — the amount or payment rail must be tied to the demand.
    if (!paymentCues.length) {
      const demand = [
        /\b(?:deposit|fee)\s*(?:of\s*)?\$\s?\d[\d,.]*/i,
        /\$\s?\d[\d,.]*[^.\n]{0,30}\b(?:fee|deposit|upfront|is required)/i,
        /\b(?:pay|payment|send)\b[^.\n]{0,40}\b(?:usdt|btc|crypto(?:currency)?|gift\s?cards?|wire transfer|zelle|cash\s?app)/i,
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
        points: 35,
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
        points: 25,
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
    const score = sp.scam_score || 0;
    if (score >= 25) {
      signals.push({
        id: 'high_keyword_score',
        label: `Elevated scam-pattern score (${score}/100)`,
        category: 'red',
        points: Math.min(20, Math.round(score * 0.25)),
        evidence: {
          source: 'detect_scam_patterns',
          detail: `Matched ${sp.keyword_count || 0} known scam indicators`,
        },
      });
    }
  }

  // --- Domain / DNS signals ----------------------------------------------
  const dom = data('lookup_domain_rdap');
  if (dom) {
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
    if (dom.is_disposable) {
      signals.push({
        id: 'disposable_email_domain',
        label: 'Disposable / temporary email domain',
        category: 'red',
        points: 20,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} is a known disposable provider` },
      });
    }
    const mx = dom.dns_records?.MX || [];
    if (mx.length === 0) {
      signals.push({
        id: 'no_mx_records',
        label: 'No mail (MX) records for domain',
        category: 'red',
        points: 12,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} cannot receive email — unusual for a real employer` },
      });
    } else {
      signals.push({
        id: 'has_mx',
        label: 'Domain has valid mail records',
        category: 'positive',
        points: -5,
        evidence: { source: 'lookup_domain_rdap', detail: `${dom.domain} has ${mx.length} MX record(s)` },
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
        label: active ? 'Company registered & active' : 'Company found in registry',
        category: 'positive',
        points: active ? -15 : -8,
        evidence: {
          source: 'lookup_company_registry',
          detail: `${comp.company_name} — ${comp.status || 'registered'}${comp.jurisdiction ? `, ${comp.jurisdiction}` : ''}`,
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
    if (research.scam_mentions) {
      signals.push({
        id: 'web_scam_warnings',
        label: 'Public scam warnings found online',
        category: 'red',
        points: 18,
        evidence: {
          source: 'research_company_web',
          detail: `Web search surfaced scam/fraud/complaint mentions for "${entities.companies[0] || 'this company'}"${research.citations?.[0] ? ` (${research.citations[0]})` : ''}`,
        },
      });
    }
    if (research.official_listing_found) {
      signals.push({
        id: 'official_listing',
        label: 'Official job listing found online',
        category: 'positive',
        points: -10,
        evidence: {
          source: 'research_company_web',
          detail: `A matching official careers/job listing was found${research.citations?.[0] ? ` (${research.citations[0]})` : ''}`,
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
        detail: 'Offer/onboarding language with no interview — atypical for legitimate hiring',
      },
    });
  }

  return dedupeById(signals);
}
