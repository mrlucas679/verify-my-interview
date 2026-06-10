export interface Sample {
  id: string;
  label: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: 'ring',
    label: 'Professional offer (ring case)',
    // A NEW email that references infrastructure seeded in the intelligence
    // network (domain + wallet + phone) — the match is computed live, nothing
    // about the verdict is hardcoded.
    text: `From: Daniel Okafor <d.okafor@nimbus-talent-hr.com>
Reply-To: nimbus.onboarding@gmail.com
Received: from mail.nimbus-talent-hr.com (203.0.113.45) by mx.recipient.com
Authentication-Results: mx.recipient.com; spf=fail smtp.mailfrom=nimbus-talent-hr.com; dmarc=fail
Subject: Final onboarding step - Senior QA Analyst (Remote) at Google

Dear Candidate,

Following your successful screening, we are pleased to confirm your selection for the
Senior QA Analyst (Remote) position at Google, facilitated through our talent partner
Nimbus Talent.

To activate your equipment shipment and payroll profile, a refundable compliance
deposit of $200 is required. Payment can be made in USDT to wallet TQrKp4mNbu77 or
via Zelle: nimbus-onboard.

Kindly complete this within 24 hours to retain your slot. For any questions, reach
our onboarding desk on WhatsApp at +1 (332) 555-0144 or visit
https://nimbustalent-careers.net/onboarding.

Warm regards,
Daniel Okafor
Senior Talent Acquisition Lead`,
  },
  {
    id: 'scam',
    label: 'Obvious scam',
    text:
      'Congratulations! After reviewing your profile we want to offer you a remote ' +
      'data-entry position paying $45/hour. To get started today you must pay a $250 ' +
      'refundable equipment fee via gift card. This offer is urgent and expires in 2 hours. ' +
      'Please also send your bank account details to set up direct deposit.',
  },
  {
    id: 'impersonation',
    label: 'Company impersonation',
    text:
      'Hello, this is the HR team at Google. We found your resume and would like to ' +
      'fast-track you for a Software Engineer role. Please continue the process with our ' +
      'recruiter at careers@google-hiring-team.com and complete the onboarding at ' +
      'http://google-careers-portal.net/apply.',
  },
  {
    id: 'legit',
    label: 'Looks legitimate',
    text:
      'Hi, thanks for applying to the Backend Engineer role at Atlassian. We would like to ' +
      'schedule a first interview next week. You can reply to me at jordan.lee@atlassian.com ' +
      'or book a slot via our careers page at https://www.atlassian.com/company/careers.',
  },
  {
    id: 'thin',
    label: 'Thin evidence',
    text: 'Are you interested in a job? Reply YES for details.',
  },
];
