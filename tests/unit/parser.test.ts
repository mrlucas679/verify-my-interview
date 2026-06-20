import { EvidenceParser } from '../../src/utils/parser';

describe('EvidenceParser entity extraction', () => {
  it('does not treat Received-header IP addresses as phone numbers', () => {
    const parsed = EvidenceParser.parse(`From: TalentBridge <jobs@talentbridge.example>
Received: from unknown (203.0.113.99) by mx.recipient.com
Subject: Amazon interview

We are coordinating an interview for Amazon. No phone number was provided.`);

    expect(parsed.phones).toEqual([]);
  });

  it('prioritizes the impersonated employer when a staffing shell is also present', () => {
    const parsed = EvidenceParser.parse(`This came from TalentBridge about an Amazon remote analyst role.
TalentBridge said the Amazon interview would happen over chat after a USDT activation fee.`);

    expect(parsed.companies[0]).toBe('Amazon');
    expect(parsed.companies).toContain('TalentBridge');
  });

  it('extracts voice-style company-name phrasing', () => {
    const parsed = EvidenceParser.parse(
      'I wanted to report this. The company name is Fake Identity. They asked people to pay R6 000 for training.'
    );

    expect(parsed.companies).toContain('Fake Identity');
  });

  it('extracts voice-style "company called" phrasing before speech verbs', () => {
    const parsed = EvidenceParser.parse(
      'The company called QuickHire Partners said people paid R 6 000 for training before starting.'
    );

    expect(parsed.companies).toContain('QuickHire Partners');
  });

  it('does not treat a recruiter first name as the company to research', () => {
    const parsed = EvidenceParser.parse(
      'Interview invitation from Sarah at Contoso Careers for a product manager role. No fees are required.'
    );

    expect(parsed.companies[0]).toBe('Contoso');
    expect(parsed.companies).not.toContain('Sarah');
  });

  it('derives the company from an official careers domain in a clean invite', () => {
    const parsed = EvidenceParser.parse(
      'Hello, your interview with Contoso is scheduled for Tuesday at 10:00. Join using the Teams link from careers.contoso.com.'
    );

    expect(parsed.companies[0]).toBe('Contoso');
    expect(parsed.companies).not.toContain('Tuesday');
    expect(parsed.domains).toContain('careers.contoso.com');
  });

  it('does not treat Google Jobs or LinkedIn source text as the employer', () => {
    const parsed = EvidenceParser.parse(`TransUnion LLC
Senior Investigator Consultant - Remote
TransUnion LLC · Johannesburg · via Workday
Apply on LinkedIn
Source: LinkedIn/Google Jobs
Recruiter email careers@transunion.com`);

    expect(parsed.companies[0]).toBe('TransUnion');
    expect(parsed.companies).not.toContain('Google');
    expect(parsed.companies).not.toContain('LinkedIn');
  });
});
