# Report Schema

## Output Structure

The agent must return a single JSON object matching this schema:

```json
{
  "risk_score": 0,
  "risk_level": "string",
  "confidence": 0.0,
  "case_summary": "",
  "entities": {
    "companies": [],
    "people": [],
    "emails": [],
    "domains": [],
    "urls": [],
    "phones": [],
    "money_requests": [],
    "job_titles": []
  },
  "verified_facts": [],
  "red_flags": [],
  "positive_signals": [],
  "missing_evidence": [],
  "recommended_next_steps": [],
  "tool_results_used": []
}
```

## Field Definitions

### risk_score

**Type**: `number` (0–100)  
**Description**: Numerical risk score. 0 = no risk detected, 100 = extremely high risk.

**Scoring Guidelines**:

- 0–20: Low Risk
- 21–40: Needs More Verification
- 41–70: Suspicious
- 71–90: Likely Scam
- 91–100: Likely Scam (very high confidence)

### risk_level

**Type**: `enum`  
**Options**:

- `"Low Risk"`
- `"Needs More Verification"`
- `"Suspicious"`
- `"Likely Scam"`
- `"Inconclusive"`

**Description**: Categorical risk assessment. Map from `risk_score`:

- 0–20 → `"Low Risk"`
- 21–40 → `"Needs More Verification"`
- 41–70 → `"Suspicious"`
- 71–100 → `"Likely Scam"`
- Insufficient data → `"Inconclusive"`

### confidence

**Type**: `number` (0.0–1.0)  
**Description**: Confidence in the risk assessment. Based on:

- Coverage of tool calls (100% of entities verified = high confidence)
- Tool quality (RDAP lookup more reliable than web search)
- Signal alignment (all signals point same direction = high confidence)
- Missing evidence (evidence gaps lower confidence)

**Example**:

- All tools ran successfully, all signals align → confidence: 0.95
- Missing company registry, only pattern detection → confidence: 0.60
- Insufficient evidence → confidence: 0.30

### case_summary

**Type**: `string`  
**Description**: Concise 1–3 sentence summary of the case.

**Example**:
"Job offer claims to be from Google but recruiter email uses different domain. Domain was recently registered and lacks SPF/DMARC records. Upfront payment requested for training."

### entities

**Type**: `object`  
**Description**: Extracted entities from evidence.

- `companies`: Array of company names mentioned
- `people`: Array of person names (or "[Name]" placeholders)
- `emails`: Array of email addresses
- `domains`: Array of domain names
- `urls`: Array of URLs
- `phones`: Array of phone numbers
- `money_requests`: Array of payment/money requests (e.g., "$50 upfront for training")
- `job_titles`: Array of job titles mentioned

### verified_facts

**Type**: `array of strings`  
**Description**: Facts confirmed via tool calls.

**Example**:

```json
[
  "Google is a real company (founded 1998, domain google.com)",
  "Company registry shows Google's official domain is google.com",
  "Recruiter email domain (abc-solutions.com) does not match Google's official domain"
]
```

### red_flags

**Type**: `array of strings`  
**Description**: Suspicious signals detected. Each should reference a verified fact or tool result, not speculation.

**Example**:

```json
[
  "Upfront payment request ($50) for training (tool: detect_scam_patterns)",
  "Recruiter email domain was created 2024-01-15, only 150 days ago (tool: lookup_domain_rdap)",
  "Email domain lacks SPF/DMARC records (tool: lookup_dns_records)",
  "URL points to abc-solutions.com, not google.com (verified from URL)"
]
```

### positive_signals

**Type**: `array of strings`  
**Description**: Legitimate signals that reduce risk.

**Example**:

```json
[
  "Company name (Google) is real and registered",
  "Email communication syntax appears professional"
]
```

### missing_evidence

**Type**: `array of strings`  
**Description**: Critical facts that could not be verified. Used to explain gaps and lower confidence.

**Example**:

```json
[
  "No company registry lookup performed (company name not clearly stated)",
  "No URL reputation check (URL not extracted)"
]
```

### recommended_next_steps

**Type**: `array of strings`  
**Description**: Concrete actions the user should take.

**Example**:

```json
[
  "Do not send money or personal information",
  "Contact Google's HR directly using official channels (google.com/careers)",
  "Report the sender's email address as phishing to your email provider",
  "Search for the job title on Google Careers to verify the posting"
]
```

### tool_results_used

**Type**: `array of strings`  
**Description**: Names of tools called during investigation.

**Example**:

```json
[
  "lookup_company_registry",
  "lookup_domain_rdap",
  "lookup_dns_records",
  "detect_scam_patterns"
]
```

## Example Reports

### Example 1: Likely Scam

```json
{
  "risk_score": 95,
  "risk_level": "Likely Scam",
  "confidence": 0.92,
  "case_summary": "Job offer claims to be from Google but uses spoofed domain. Upfront payment requested. Domain recently registered without SPF/DMARC records.",
  "entities": {
    "companies": ["Google"],
    "people": [],
    "emails": ["recruiter@abc-solutions.com"],
    "domains": ["abc-solutions.com"],
    "urls": ["http://abc-solutions.com/apply"],
    "phones": [],
    "money_requests": ["$50 upfront for training"],
    "job_titles": []
  },
  "verified_facts": [
    "Google is a real company registered with SEC",
    "Google's official domain is google.com",
    "Recruiter email uses abc-solutions.com, not google.com",
    "abc-solutions.com was registered 2024-01-15 (150 days ago)",
    "Domain has no SPF or DMARC records"
  ],
  "red_flags": [
    "Upfront payment request for training",
    "Email domain does not match company official domain",
    "Recruiter domain recently registered",
    "Weak email authentication (no SPF/DMARC)"
  ],
  "positive_signals": ["Company name is real"],
  "missing_evidence": [],
  "recommended_next_steps": [
    "Do not send money or personal information",
    "Contact Google HR via google.com/careers/",
    "Report email as phishing"
  ],
  "tool_results_used": [
    "lookup_company_registry",
    "lookup_domain_rdap",
    "lookup_dns_records",
    "detect_scam_patterns"
  ]
}
```

### Example 2: Low Risk

```json
{
  "risk_score": 8,
  "risk_level": "Low Risk",
  "confidence": 0.88,
  "case_summary": "Job posting from established company using official domain. No red flags detected. Posting matches official career portal.",
  "entities": {
    "companies": ["Microsoft"],
    "people": [],
    "emails": ["careers@microsoft.com"],
    "domains": ["microsoft.com"],
    "urls": ["https://careers.microsoft.com/us/en/job/1234"],
    "phones": [],
    "money_requests": [],
    "job_titles": ["Software Engineer"]
  },
  "verified_facts": [
    "Microsoft is a real company",
    "Email domain matches official domain (microsoft.com)",
    "microsoft.com is well-established (registered 1991)",
    "SPF/DMARC records properly configured",
    "Job listing found on official careers portal"
  ],
  "red_flags": [],
  "positive_signals": [
    "Communication from official company domain",
    "Well-established domain (35+ years old)",
    "Strong email authentication",
    "Posting verifiable on official site",
    "Normal hiring timeline"
  ],
  "missing_evidence": [],
  "recommended_next_steps": [
    "Verify job details on careers.microsoft.com",
    "Contact Microsoft HR if you have questions"
  ],
  "tool_results_used": [
    "lookup_company_registry",
    "lookup_domain_rdap",
    "lookup_dns_records"
  ]
}
```

### Example 3: Inconclusive (Insufficient Evidence)

```json
{
  "risk_score": 0,
  "risk_level": "Inconclusive",
  "confidence": 0.15,
  "case_summary": "Insufficient evidence provided. Please provide job posting, recruiter email, or other specific details for analysis.",
  "entities": {
    "companies": [],
    "people": [],
    "emails": [],
    "domains": [],
    "urls": [],
    "phones": [],
    "money_requests": [],
    "job_titles": []
  },
  "verified_facts": [],
  "red_flags": [],
  "positive_signals": [],
  "missing_evidence": [
    "No company name provided",
    "No recruiter email or contact information",
    "No job posting or description",
    "No URL or communication sample"
  ],
  "recommended_next_steps": [
    "Provide the job posting, recruiter email, or communication sample",
    "Include company name and any contact information",
    "Share URLs or links if mentioned"
  ],
  "tool_results_used": []
}
```
