# Tool Strategy & Implementation

## Tool Categories

### 1. Company Registry Lookup

**Function**: `lookup_company_registry(company_name: string)`

**Purpose**: Verify company exists and find official domain.

**Returns**:

```typescript
{
  found: boolean;
  domain?: string;
  founded?: number;
  legal_name?: string;
  country?: string;
}
```

**Red Flags Detected**:

- Company not found (possible impersonation)
- Multiple domains for same company (spoofing possibility)

**Decision Rule**:

- Company in evidence → call this tool
- Use result to get official domain for DNS/DMARC checks

---

### 2. Domain RDAP Lookup

**Function**: `lookup_domain_rdap(domain: string)`

**Purpose**: Get domain registration details (age, registrant, registrar).

**Returns**:

```typescript
{
  created: Date;
  updated?: Date;
  expires?: Date;
  registrant?: string;
  registrar?: string;
}
```

**Red Flags Detected**:

- Recently created domain (< 180 days)
- Anonymous registrant
- Frequent updates (possible reregistration)

**Decision Rule**:

- Email domain in evidence → call this tool
- URL domain in evidence → call this tool
- Result used for "domain age" signal

---

### 3. DNS Records Lookup

**Function**: `lookup_dns_records(domain: string)`

**Purpose**: Check email authentication records (SPF, DMARC).

**Returns**:

```typescript
{
  mx_records: string[];
  spf_record?: string;
  dmarc_record?: string;
}
```

**Red Flags Detected**:

- Missing SPF record
- Missing DMARC policy
- MX record mismatch

**Decision Rule**:

- Email domain in evidence → call this tool after RDAP
- Result used for "DNS authentication" signal

---

### 4. URL Reputation Lookup

**Function**: `check_url_reputation(url: string)`

**Purpose**: Scan URL for phishing, malware, reputation.

**Returns**:

```typescript
{
  phishing_risk: number; // 0-100
  malware_risk: number; // 0-100
  reputation_score: number; // 0-100
  reported_as: string[]; // ["phishing", "malware", ...]
}
```

**Red Flags Detected**:

- High phishing score
- Reported by reputation databases
- URL shortener or obfuscation

**Decision Rule**:

- URL in evidence → call this tool
- If score > 50, mark as red flag

---

### 5. Web Reputation Search

**Function**: `search_reputation_web(query: string, limit?: number)`

**Purpose**: Search reputation databases, forums, blacklists.

**Returns**:

```typescript
{
  results: {
    source: string;
    url: string;
    title: string;
    snippet: string;
  }
  [];
}
```

**Red Flags Detected**:

- Domain appears in scam reports
- Email appears in complaint databases
- Phone number flagged as spam

**Decision Rule**:

- Domain or email appears suspicious → optional search
- Limit to 2 searches per case (MVP)

---

### 6. Scam Pattern Detection

**Function**: `detect_scam_patterns(evidence: string)`

**Purpose**: Local pattern matching (no external calls). Identifies common scam keywords/phrases.

**Returns**:

```typescript
{
  upfront_payment: boolean;
  impersonation: boolean;
  urgency: boolean;
  identity_request: boolean;
  grammar_issues: number; // 0-1 confidence
  suspicious_phrases: string[];
}
```

**Red Flags Detected**:

- Keywords: "upfront", "training fee", "equipment cost"
- Urgency: "immediate", "today", "last chance"
- Identity: "SSN", "bank account", "credit card"

**Decision Rule**:

- Call on all evidence (local, no tool budget impact)
- Used to identify payment scams and urgency tactics

---

## Tool Call Orchestration

### Execution Flow

```
1. Parse Evidence
   ├─ Extract companies, emails, domains, URLs, phones, payment phrases
   ├─ Identify which tools are needed
   └─ Plan execution (parallel where possible)

2. Execute Tools (Max 10 calls)
   ├─ lookup_company_registry (for each company)
   ├─ lookup_domain_rdap (for each email/URL domain)
   ├─ lookup_dns_records (after RDAP for each domain)
   ├─ check_url_reputation (for each URL)
   ├─ detect_scam_patterns (always, local)
   └─ search_reputation_web (optional, if needed)

3. Normalize Signals
   └─ Convert tool results to standardized signal objects

4. Score Risk
   └─ Combine signals using deterministic rules

5. Write Report
   └─ Format as JSON with verified facts and red flags
```

### Caching Strategy

Cache results by:

- **Domain**: `abc-solutions.com` RDAP lookup cached
- **Company**: `Google` registry lookup cached
- **URL**: Full URL reputation lookup cached

**Rationale**: Same domain/company may appear multiple times in evidence. Reuse results to stay under tool budget.

---

## Tool Budget & Prioritization

### MVP Limits (per case)

- **Total tool calls**: Max 10
- **Searches**: Max 2
- **URL scans**: Max 1

### Priority Order

1. **Company registry** (highest signal value)
2. **Domain RDAP** (detects impersonation)
3. **DNS records** (email authentication)
4. **Pattern detection** (always, no budget impact)
5. **URL reputation** (if URLs extracted)
6. **Web search** (lowest priority, use if remaining budget)

### Budget Exhaustion

If budget exhausted:

- Include "missing_evidence" in report
- Lower confidence
- Recommend user provide more specific evidence

---

## Error Handling

### Tool Call Failures

**Timeout**: Mark as "could not verify" in report, lower confidence
**Rate limit**: Queue call for retry, or skip if budget exhausted
**Invalid input**: Validation before tool call (catch user error)

### Empty Results

**Company not found**: Treat as "company does not exist" signal (red flag)
**No DNS records**: Treat as "weak authentication" (red flag)
**URL not accessible**: "Cannot verify URL" (missing evidence)

---

## Implementation Checklist

- [ ] Define OpenAPI schema for each tool
- [ ] Implement tool adapters (if calling external APIs)
- [ ] Implement caching layer
- [ ] Implement tool orchestrator (planner)
- [ ] Add tool call logging for tracing
- [ ] Add error handling and retry logic
- [ ] Add input validation
- [ ] Create mock tools for testing
