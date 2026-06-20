import guidance from '../../src/data/guidance.json';

const EMITTED_RED_SIGNALS = [
  'reply_to_mismatch',
  'dmarc_fail',
  'spf_fail',
  'freemail_corporate_claim',
  'upfront_payment_request',
  'credential_request',
  'urgency_pressure',
  'high_keyword_score',
  'recently_registered_domain',
  'newish_domain',
  'disposable_email_domain',
  'no_mx_records',
  'risky_tld_domain',
  'email_flagged_high_risk',
  'proxy_hosting_sender_ip',
  'voip_recruiter_number',
  'high_risk_phone',
  'company_not_in_registry',
  'web_scam_warnings',
  'lookalike_domain',
  'money_mule_request',
  'unofficial_application_channel',
  'training_fee_narrative',
  'sms_reply_bait',
  'whatsapp_only_application',
  'no_interview_offer',
  'network_infrastructure_match',
  'network_match',
];

describe('official guidance coverage', () => {
  it('maps every emitted red signal to at least one official guidance entry', () => {
    const mapped = new Set<string>();
    for (const entry of guidance) {
      for (const id of entry.signal_ids) mapped.add(id);
    }

    expect(EMITTED_RED_SIGNALS.filter((id) => !mapped.has(id))).toEqual([]);
  });
});
