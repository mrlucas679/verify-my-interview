// PII redaction & data minimization.
//
// POPIA (Protection of Personal Information Act, 4 of 2013) condition 3
// (minimality, s10) and condition 7 (security safeguards, s19) require that we
// process only the personal information necessary for the purpose, and protect
// it. This module is where that policy is enforced in code.
//
// Key distinction for a fraud-intelligence product:
//   - Scam INDICATORS (the recruiter's email, domain, phone, payment handle)
//     ARE the evidence. Processing them to detect/attribute fraud is the
//     legitimate-interest purpose (POPIA s11(1)(f)); they are intentionally
//     preserved.
//   - The data subject's (or a bystander's) SENSITIVE identifiers — South
//     African ID numbers, bank-account numbers, payment-card numbers — are
//     NEVER needed to detect or attribute a scam. They are stripped before any
//     evidence text is logged or stored.
//
// `redactSensitiveIdentifiers` is the storage/display filter (keeps IOCs).
// `maskForLogs` is the stricter log filter (also masks emails/phones), because
// logs are the easiest place for personal information to leak and linger.

export interface RedactionResult {
  text: string;
  /** kind -> number of items masked, for audit/telemetry (no values logged). */
  redactions: Record<string, number>;
}

interface Rule {
  kind: string;
  re: RegExp;
  /** Replacement: a fixed tag, or a function for partial masking. */
  to: string | ((m: string, ...g: string[]) => string);
}

/**
 * Strip sensitive personal identifiers from free-text evidence while leaving
 * scam IOCs intact. Use before persisting or returning user-submitted text.
 */
export function redactSensitiveIdentifiers(input: string): RedactionResult {
  const redactions: Record<string, number> = {};
  if (!input) return { text: '', redactions };

  const rules: Rule[] = [
    // Payment-card numbers (16 digits, optionally grouped) — check before the
    // 13-digit ID rule so a card is never mis-tagged as an ID.
    { kind: 'card_number', re: /\b(?:\d[ -]?){15}\d\b/g, to: '[CARD_REDACTED]' },
    // South African ID number: 13 digits, contiguous or spaced YYMMDD SSSS CAZ.
    { kind: 'sa_id_number', re: /\b\d{6}[ ]?\d{4}[ ]?\d{3}\b/g, to: '[SA_ID_REDACTED]' },
    { kind: 'sa_id_number', re: /\b\d{13}\b/g, to: '[SA_ID_REDACTED]' },
    // Bank-account number: an 8–12 digit run explicitly in account/banking
    // context (avoids clobbering phone numbers, which are scam IOCs we keep).
    {
      kind: 'bank_account',
      re: /\b(account|acc|a\/c|bank)([^.\n\d]{0,20})\b(\d{8,12})\b/gi,
      to: (_m, w: string, sep: string) => `${w}${sep}[ACCOUNT_REDACTED]`,
    },
  ];

  let text = input;
  for (const rule of rules) {
    text = text.replace(rule.re, (...args: any[]) => {
      redactions[rule.kind] = (redactions[rule.kind] ?? 0) + 1;
      return typeof rule.to === 'function' ? (rule.to as any)(...args) : rule.to;
    });
  }
  return { text, redactions };
}

/**
 * Stricter masking for anything written to logs: everything
 * `redactSensitiveIdentifiers` removes, plus email local-parts and phone
 * digits. Logs should never carry recoverable personal information.
 */
export function maskForLogs(input: string): string {
  if (!input) return '';
  let text = redactSensitiveIdentifiers(input).text;
  // Emails: keep the first character and the domain ( j***@scam-domain.co.za ).
  text = text.replace(
    /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    '$1***@$2'
  );
  // Phone-like runs: keep the last two digits only.
  text = text.replace(/\+?\d[\d().\-\s]{6,}\d/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 7 ? `[PHONE ***${digits.slice(-2)}]` : m;
  });
  return text;
}

/** Convenience: redact then hard-cap length for a stored field. */
export function redactAndCap(input: string, max: number): string {
  return redactSensitiveIdentifiers(input).text.slice(0, max);
}
