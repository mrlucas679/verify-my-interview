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
      summary: `Classified input as ${evidenceType.replace('_', ' ')}; extracted ${counts || 'no entities'}${
        headers.isRawEmail ? '; parsed full email headers' : ''
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
        claim: `Evidence classified as ${evidenceType.replace('_', ' ')}`,
        evidence: 'Structural analysis of the submitted content',
        confidence: 0.9,
        source: 'parser',
      },
    ];
    if (entities.emails.length || entities.domains.length) {
      findings.push({
        claim: `Identified ${entities.emails.length} email address(es) and ${entities.domains.length} domain(s) to verify`,
        evidence: [...entities.emails, ...entities.domains].slice(0, 5).join(', '),
        confidence: 0.95,
        source: 'parser',
      });
    }
    if (headers.isRawEmail) {
      findings.push({
        claim: 'Full email headers present and parsed',
        evidence: `From ${headers.fromAddress ?? 'unknown'}${headers.replyToAddress ? `, Reply-To ${headers.replyToAddress}` : ''}${headers.senderIp ? `, origin IP ${headers.senderIp}` : ''}`,
        confidence: 0.95,
        source: 'email_headers',
      });
      if (headers.replyToMismatch) {
        findings.push({
          claim: 'Reply-To routes replies to a different domain than the sender',
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
            claim: `${mech} authentication failed for the sending domain`,
            evidence: `Authentication-Results: ${mech.toLowerCase()}=${value}`,
            confidence: 0.9,
            source: 'email_headers',
          });
        }
      }
    }
    if (entities.money_requests.length) {
      findings.push({
        claim: 'Evidence contains payment/fee language',
        evidence: entities.money_requests.slice(0, 4).join(', '),
        confidence: 0.85,
        source: 'parser',
      });
    }
    return findings;
  }
}
