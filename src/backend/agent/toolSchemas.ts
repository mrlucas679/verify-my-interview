export const toolSchemas = [
  {
    name: 'lookup_company_registry',
    description: 'Verify company existence and details via OpenCorporates registry',
    inputSchema: {
      type: 'object',
      properties: {
        company_name: {
          type: 'string',
          description: 'Official company name',
        },
        registration_number: {
          type: 'string',
          description: 'Company registration/incorporation number',
        },
        country: {
          type: 'string',
          description: 'Country code (e.g., US, GB, CA, AU)',
        },
      },
      required: [],
    },
  },
  {
    name: 'lookup_domain_rdap',
    description:
      'Lookup domain WHOIS data, DNS records, geolocation, and check if disposable email',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Domain name to verify (e.g., example.com)',
        },
      },
      required: ['domain'],
    },
  },
  {
    name: 'detect_scam_patterns',
    description:
      'Analyze text for scam-related keywords, urgency language, payment requests, credential requests',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to analyze (email body, message, job description)',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'research_company_web',
    description:
      'Search the public web (OSINT) for the company and role to find official job listings and any scam/fraud warnings or complaints. Returns citations.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name to research' },
        role: { type: 'string', description: 'Job title/role, if known' },
        domain: { type: 'string', description: "The recruiter's email/website domain, if known" },
      },
      required: ['company'],
    },
  },
];
