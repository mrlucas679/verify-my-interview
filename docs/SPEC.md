# Full System Specification

## Problem Statement

Job seekers are vulnerable to interview and offer scams, including:

- Fake job postings using real company names
- Email spoofing (recruiter@company.com variants)
- Payment requests for equipment, training, or onboarding fees
- Phishing links disguised as company portals
- Requests for personal/banking information

Current detection is manual, intuitive, or pattern-based. This system provides **evidence-based, step-by-step verification** of suspicious job offers.

## Solution Overview

The system orchestrates a **multi-step investigation pipeline**:

```
Evidence Input
    ↓
Parser (extract entities: company, email, URL, payment request)
    ↓
Foundry Reasoning Agent (plan which tools to call)
    ↓
Tool Execution (company lookup, domain checks, reputation scans)
    ↓
Signal Normalization (convert tool results to standardized signals)
    ↓
Deterministic Risk Scorer (combine signals → risk score)
    ↓
Report Writer (explain reasoning in structured JSON)
    ↓
Risk Report (score, level, confidence, red flags, next steps)
```

## Key Design Decisions

### 1. Reasoning + Deterministic Scoring (Not ML)

The agent reasons about which tools to call (flexible), but the final score is deterministic (explainable).

**Why**: Job seekers need to understand _why_ the system flagged something. An opaque neural network risks false positives in sensitive domain.

### 2. Evidence-Based, Not Pattern-Based

The system prefers to call external tools and compare user claims against verified reality. Pattern detection is secondary.

**Why**: Scammers constantly evolve tactics. Verified facts (domain age, company registry status, DNS records) are harder to spoof than static patterns.

### 3. Conservative Risk Assessment

If evidence is missing, the system lowers confidence rather than inventing facts or over-scoring.

**Why**: Job seekers should trust the system. A false "Likely Scam" causes real harm (rejected legitimate offers).

### 4. Tool Budget + Caching

Recommended max 10 tool calls per case for MVP. Results are cached to avoid redundant lookups.

**Why**: Scales better, respects tool rate limits, reduces latency.

## Data Flow

### Input: Evidence

User provides unstructured evidence (email, chat, URL, phone number, etc.).

Example:

```
From: recruiter@abc-solutions.com
Subject: Exciting opportunity at Google!

Dear [Name],
We are hiring for Google. Please complete training: $50 upfront.
Link: http://abc-solutions.com/apply
Phone: +1-555-0123
```

### Parser Output: Entities

```json
{
  "companies": ["Google"],
  "people": ["[Name]"],
  "emails": ["recruiter@abc-solutions.com"],
  "domains": ["abc-solutions.com"],
  "urls": ["http://abc-solutions.com/apply"],
  "phones": ["+1-555-0123"],
  "money_requests": ["$50 upfront for training"],
  "job_titles": []
}
```

### Tool Execution: Plan

Foundry agent reasons:

- "Google is a known company → call `lookup_company_registry`"
- "Email found → call `lookup_domain_rdap` and `lookup_dns_records`"
- "URL found → call `check_url_reputation`"
- "Upfront payment found → call `detect_scam_patterns`"

### Tool Results

```
lookup_company_registry(company="Google") →
  { found: true, domain: "google.com", founded: 1998 }

lookup_domain_rdap(domain="abc-solutions.com") →
  { created: 2024-01-15, registrant: "Anonymous" }

lookup_dns_records(domain="abc-solutions.com") →
  { mx_records: ["mail.abc-solutions.com"], spf: "none", dmarc: "none" }

detect_scam_patterns(evidence) →
  { upfront_payment: true, impersonation: true, urgency: false }
```

### Signals

Normalized signals derived from tool results:

```json
{
  "company_registry_match": { "present": true, "real_domain": "google.com" },
  "email_domain_mismatch": true,
  "recruiter_domain_age": { "days": 150, "red_flag": true },
  "upfront_payment_request": true,
  "dns_records_weak": true,
  "url_belongs_to_different_domain": true
}
```

### Risk Score

Deterministic scorer combines signals:

```
base_score = 0
if upfront_payment_request: +35 points
if email_domain_mismatch: +25 points
if recruiter_domain_age < 180 days: +20 points
if dns_records_weak: +15 points
if url_domain != company_domain: +15 points

risk_score = min(100, base_score)
confidence = 0.95
risk_level = "Likely Scam"
```

## Implementation Priority

1. Backend tools setup
2. Define OpenAPI/function schemas
3. Create Foundry reasoning agent
4. Connect Express server
5. Add deterministic scorer
6. Add report writer
7. Add traces and evaluation cases

## Success Metrics

- Accuracy: 80%+ on test cases
- Explainability: Each risk factor traceable
- Privacy: No sensitive data in logs
- Latency: <5 seconds (P95)
- Coverage: Tools called for all entities
