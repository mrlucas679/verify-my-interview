import {
  redactSensitiveIdentifiers,
  maskForLogs,
  redactAndCap,
} from '../../src/backend/privacy/redaction';

describe('redactSensitiveIdentifiers', () => {
  it('redacts a South African ID number (contiguous and spaced)', () => {
    expect(redactSensitiveIdentifiers('ID 9001015800089 attached').text).toBe(
      'ID [SA_ID_REDACTED] attached'
    );
    expect(redactSensitiveIdentifiers('ID 900101 5800 089').text).toContain('[SA_ID_REDACTED]');
  });

  it('redacts a payment-card number before it can be mistaken for an ID', () => {
    const out = redactSensitiveIdentifiers('card 4111 1111 1111 1111 used');
    expect(out.text).toBe('card [CARD_REDACTED] used');
    expect(out.redactions.card_number).toBe(1);
  });

  it('redacts a bank account number only in account context', () => {
    expect(redactSensitiveIdentifiers('account 620112345678 at the bank').text).toContain(
      '[ACCOUNT_REDACTED]'
    );
  });

  it('PRESERVES scam IOCs — recruiter email, domain and phone are the evidence', () => {
    const evidence = 'Apply to recruit@scam-jobs.co.za or WhatsApp 0612720756';
    const out = redactSensitiveIdentifiers(evidence).text;
    expect(out).toContain('recruit@scam-jobs.co.za');
    expect(out).toContain('0612720756');
  });

  it('counts redactions without leaking the values', () => {
    const out = redactSensitiveIdentifiers('IDs 9001015800089 and 8506220123083');
    expect(out.redactions.sa_id_number).toBe(2);
    expect(out.text).not.toMatch(/\d{13}/);
  });
});

describe('maskForLogs', () => {
  it('masks email local-parts but keeps the domain for IOC triage', () => {
    expect(maskForLogs('from jane.doe@scam-domain.co.za')).toBe('from j***@scam-domain.co.za');
  });

  it('masks phone digits except the last two', () => {
    expect(maskForLogs('call 0612720756 now')).toBe('call [PHONE ***56] now');
  });

  it('still strips sensitive identifiers in log output', () => {
    expect(maskForLogs('id 9001015800089')).toContain('[SA_ID_REDACTED]');
  });
});

describe('redactAndCap', () => {
  it('redacts then caps to the requested length', () => {
    expect(redactAndCap('x'.repeat(100), 10)).toHaveLength(10);
  });
});
