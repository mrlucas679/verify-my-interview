// Stage 1 — Evidence agent.
//
// Turns whatever the user submitted (raw email with headers, OCR'd screenshot
// text, a URL, plain text) into structured entities plus header intelligence.
// Extraction is deterministic by design: regex + header parsing over untrusted
// input is more reliable and auditable than an LLM here, and every downstream
// agent reasons over its output.

import { EvidenceParser } from '../../../utils/parser';
import { analyzeEmailHeaders, EmailHeaderAnalysis } from '../../../utils/emailHeaders';
import { Entities } from '../../../types/entities';
import { Finding } from '../../../types/report';
import { EvidenceAgentResult, EvidenceType } from '../types';

function classify(evidence: string, headers: EmailHeaderAnalysis): EvidenceType {
  if (headers.isRawEmail) return 'email';
  const t = evidence.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'url';
  if (
    /\b(?:i\s+(?:want|wanted|need)\s+to\s+report|i(?:'|’)?m\s+reporting|report(?:ing|ed)?\s+(?:this|a\s+scam)|i\s+(?:got|was)\s+scammed)\b/i.test(
      t
    )
  ) {
    return 'report';
  }
  if (/\b(\d{1,2}:\d{2}\s?(AM|PM)?)\b.*\n.*\b\d{1,2}:\d{2}/is.test(t) || /whatsapp|telegram/i.test(t)) {
    return 'chat_screenshot';
  }
  return 'text';
}

export class EvidenceAgent {
  async run(evidence: string): Promise<EvidenceAgentResult> {
    const headers = analyzeEmailHeaders(evidence);
    const entities: Entities = EvidenceParser.parse(evidence);

    // Fold header intelligence into the entity set.
    if (headers.fromAddress && !entities.emails.includes(headers.fromAddress)) {
      entities.emails.unshift(headers.fromAddress);
    }
    if (headers.replyToAddress && !entities.emails.includes(headers.replyToAddress)) {
      entities.emails.push(headers.replyToAddress);
    }
    for (const d of [headers.fromDomain, headers.replyToDomain]) {
      if (d && !entities.domains.includes(d)) entities.domains.push(d);
    }
    if (headers.replyToAddress) entities.reply_to = headers.replyToAddress;
    if (headers.senderIp) entities.sender_ip = headers.senderIp;

    const evidenceType = classify(evidence, headers);
    const findings = this.findings(entities, headers, evidenceType);

    const counts = [
      entities.companies.length && `${entities.companies.length} company`,
      entities.emails.length && `${entities.emails.length} email`,
      entities.domains.length && `${entities.domains.length} domain`,
      entities.phones.length && `${entities.phones.length} phone`,
      entities.urls.length && `${entities.urls.length} url`,
      entities.money_requests.length && `${entities.money_requests.length} payment cue`,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      engine: 'deterministic',
      entities,
      evidenceType,
      headers,
      findings,
      summary: `Read this as ${evidenceType.replace('_', ' ')} evidence and found ${
        counts || 'nothing checkable — no email address, link, company name, or phone number'
      }${headers.isRawEmail ? '; the full email routing headers were present and examined' : ''
      }.`,
    };
  }

  private findings(
    entities: Entities,
    headers: EmailHeaderAnalysis,
    evidenceType: EvidenceType
  ): Finding[] {
    const findings: Finding[] = [
      {
        claim: `This looks like ${evidenceType.replace('_', ' ')} evidence`,
        evidence: 'The structure of the submitted text was reviewed',
        confidence: 0.9,
        source: 'parser',
      },
    ];
    if (entities.emails.length || entities.domains.length) {
      findings.push({
        claim: `Found ${entities.emails.length} email address(es) and ${entities.domains.length} domain(s) to check`,
        evidence: [...entities.emails, ...entities.domains].slice(0, 5).join(', '),
        confidence: 0.95,
        source: 'parser',
      });
    }
    if (headers.isRawEmail) {
      findings.push({
          claim: 'Full email routing headers were included',
        evidence: `From ${headers.fromAddress ?? 'unknown'}${headers.replyToAddress ? `, Reply-To ${headers.replyToAddress}` : ''}${headers.senderIp ? `, origin IP ${headers.senderIp}` : ''}`,
        confidence: 0.95,
        source: 'email_headers',
      });
      if (headers.replyToMismatch) {
        findings.push({
          claim: 'Replies go to a different domain than the sender used',
          evidence: `From domain ${headers.fromDomain} vs Reply-To domain ${headers.replyToDomain}`,
          confidence: 0.95,
          source: 'email_headers',
        });
      }
      for (const [mech, value] of [
        ['SPF', headers.spf],
        ['DKIM', headers.dkim],
        ['DMARC', headers.dmarc],
      ] as const) {
        if (value === 'fail' || value === 'softfail') {
          findings.push({
            claim: `The sender failed ${mech}, an email proof-of-sender check`,
            evidence: `Header result: ${mech.toLowerCase()}=${value}`,
            confidence: 0.9,
            source: 'email_headers',
          });
        }
      }
    }
    if (entities.money_requests.length) {
      findings.push({
        claim: 'The message mentions a payment or fee',
        evidence: entities.money_requests.slice(0, 4).join(', '),
        confidence: 0.85,
        source: 'parser',
      });
    }
    return findings;
  }
}
