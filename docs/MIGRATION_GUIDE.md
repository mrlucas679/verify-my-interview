# Migration Guide: Verify My Interview → Foundry Agent

## Overview

This guide explains how to migrate the existing **Verify My Interview** backend application into the new **Microsoft Foundry-based agent architecture**. The migration preserves proven services, data models, and infrastructure while reorganizing them around the Foundry reasoning agent.

**Key objective:** Reuse production services and data while adopting Foundry's structured reasoning and tool calling pattern.

---

## Architecture Decisions

### Database & Caching Strategy

**Keep existing stack:** Maintain MongoDB + Redis for consistency and proven reliability.

- **MongoDB**: Long-term cache (7 days) for company verifications, domain records
- **Redis**: Short-term cache (1 hour) for DNS checks, WHOIS data, geolocation results
- **In-memory**: Runtime cache within tool orchestrator for request-scoped deduplication

**Why:** The existing application has production-proven caching logic. Foundry is a reasoning engine, not a cache provider. Keep data persistence external.

### Service Integration Pattern

**Recommended approach: Adapter + Wrapper pattern**

1. Keep existing services as-is in separate directory (`src/services/legacy/`)
2. Create thin adapter wrappers in tool layer (`src/backend/tools/`)
3. Adapters translate Foundry tool calls → legacy service calls → Foundry tool results
4. Allows testing legacy services independently while wiring them into Foundry

**Benefits:**

- No refactoring of proven production code
- Easy rollback if needed
- Clear separation of concerns
- Can migrate services incrementally

### Foundry Agent Integration

**Assumption:** Microsoft Foundry provides a cloud API with structured tool calling.

**Expected flow:**

```
1. User submits evidence → Foundry agent receives input
2. Agent invokes tool calls via Foundry SDK
3. Backend receives tool requests → orchestrator maps to legacy services
4. Results returned to Foundry agent
5. Agent reasons over results → requests more tools or concludes
6. Final reasoning + signals → deterministic scorer → report
```

---

## Phase 1: Setup & Data Migration

### Step 1.1: Copy Data Files

Copy pre-built keyword and domain lists from existing app:

```bash
# From: mrlucas679/verifymyinterview/src/data/
# To: new project

cp /path/to/existing/src/data/scamKeywords.json \
   src/data/scamKeywords.json

cp /path/to/existing/src/data/disposableDomains.json \
   src/data/disposableDomains.json
```

These are loaded at startup by legacy services.

### Step 1.2: Create Legacy Services Directory

```bash
mkdir -p src/services/legacy
```

Copy or symlink existing services:

```bash
# Option A: Copy (recommended)
cp /path/to/existing/src/services/*.ts src/services/legacy/

# Option B: Git submodule or workspace reference (if mono-repo setup)
# git submodule add <url> src/services/legacy
```

Files to copy:

- `companyVerification.ts`
- `domainVerificationService.ts`
- `nlpScamDetectionService.ts`
- `openCorporatesService.ts`
- `config.ts` (or equivalent configuration)
- Any utility functions (`extractErrorMessage`, logger setup)

### Step 1.3: Copy Models (TypeScript/Mongoose)

```bash
mkdir -p src/models
cp /path/to/existing/src/models/*.ts src/models/
```

Models to copy:

- `ScamReport.ts`
- `CompanyVerification.ts`
- `Report.ts`
- `Review.ts`
- `User.ts`

These are used by legacy services for database operations.

### Step 1.4: Setup Database Connections

Create `src/infrastructure/db.ts`:

```typescript
import mongoose from "mongoose";
import redis from "redis";

export const initializeDatabase = async () => {
  // MongoDB connection
  await mongoose.connect(
    process.env.MONGODB_URI || "mongodb://localhost:27017/verify-interview",
    {
      retryWrites: true,
      w: "majority",
    },
  );

  // Redis connection
  const redisClient = redis.createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
  });

  await redisClient.connect();

  return { mongoClient: mongoose.connection, redisClient };
};
```

Update `.env`:

```
MONGODB_URI=mongodb://localhost:27017/verify-interview
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=<your-key>
OPENCORPORATES_API_KEY=<your-key>
WHOIS_XML_API_KEY=<your-key>
ABSTRACT_API_KEY=<your-key>
FOUNDRY_PROJECT_ID=<your-foundry-project>
FOUNDRY_API_KEY=<your-foundry-api-key>
```

---

## Phase 2: Adapter Layer

### Step 2.1: Create Tool Adapters

Adapters sit between Foundry tool calls and legacy services. They:

1. Receive typed Foundry tool input
2. Call legacy service
3. Transform legacy response → Foundry tool result schema

**Example: Company Lookup Adapter**

Create `src/backend/tools/adapters/companyLookup.adapter.ts`:

```typescript
import { CompanyVerificationService } from "@services/legacy/companyVerification";
import { ToolResult, ToolType } from "@types/tool_results";

const companyService = new CompanyVerificationService();

export async function companyLookupAdapter(input: {
  company_name?: string;
  registration_number?: string;
  country?: string;
}): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    // Call legacy service
    const result = await companyService.verifyCompany({
      name: input.company_name,
      regNum: input.registration_number,
      country: input.country,
    });

    if (result.error) {
      return {
        tool: "lookup_company_registry",
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
      };
    }

    return {
      tool: "lookup_company_registry",
      success: true,
      data: {
        company_name: result.company?.name,
        registration_number: result.company?.regNum,
        country: result.company?.country,
        registered: result.company?.registered,
        status: result.company?.status,
        type: result.company?.type,
        jurisdiction: result.company?.jurisdiction,
        officers: result.company?.officers || [],
        cached: result.cached || false,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: "lookup_company_registry",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - startTime,
    };
  }
}
```

**Example: Domain Lookup Adapter**

Create `src/backend/tools/adapters/domainLookup.adapter.ts`:

```typescript
import { DomainVerificationService } from "@services/legacy/domainVerificationService";
import { ToolResult } from "@types/tool_results";

const domainService = new DomainVerificationService();

export async function domainLookupAdapter(input: {
  domain: string;
}): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await domainService.checkDomainHealth(input.domain);

    if (result.error) {
      return {
        tool: "lookup_domain_rdap",
        success: false,
        error: result.error,
        duration: Date.now() - startTime,
      };
    }

    return {
      tool: "lookup_domain_rdap",
      success: true,
      data: {
        domain: input.domain,
        dns_records: result.dns || { MX: [], A: [], AAAA: [] },
        whois_data: {
          created_date: result.whois?.created,
          expiry_date: result.whois?.expiry,
          registrar: result.whois?.registrar,
          age_days: calculateDaysSince(result.whois?.created),
        },
        geolocation: result.geolocation || null,
        is_disposable: result.disposable || false,
        cached: result.cached || false,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: "lookup_domain_rdap",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - startTime,
    };
  }
}

function calculateDaysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor(
    (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
  );
}
```

**Example: Scam Pattern Detector Adapter**

Create `src/backend/tools/adapters/scamPatternDetector.adapter.ts`:

```typescript
import { NLPScamDetectionService } from "@services/legacy/nlpScamDetectionService";
import { ToolResult } from "@types/tool_results";

const nlpService = new NLPScamDetectionService();

export async function scamPatternDetectorAdapter(input: {
  text: string;
}): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    const result = await nlpService.analyzeText(input.text);

    return {
      tool: "detect_scam_patterns",
      success: true,
      data: {
        text_length: input.text.length,
        scam_score: result.score || 0, // 0-100
        found_keywords: result.foundKeywords || [],
        keyword_count: (result.foundKeywords || []).length,
        patterns_detected: categorizePatterns(result.foundKeywords || []),
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      tool: "detect_scam_patterns",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      duration: Date.now() - startTime,
    };
  }
}

function categorizePatterns(keywords: string[]): Record<string, string[]> {
  const categories: Record<string, string[]> = {
    payment_methods: [],
    urgency_language: [],
    credential_requests: [],
  };

  const paymentKeywords = [
    "wire transfer",
    "bitcoin",
    "gift card",
    "western union",
  ];
  const urgencyKeywords = ["urgent", "asap", "immediate", "hurry"];
  const credentialKeywords = ["password", "ssn", "bank account", "credit card"];

  keywords.forEach((kw) => {
    if (paymentKeywords.some((p) => kw.includes(p)))
      categories.payment_methods.push(kw);
    if (urgencyKeywords.some((u) => kw.includes(u)))
      categories.urgency_language.push(kw);
    if (credentialKeywords.some((c) => kw.includes(c)))
      categories.credential_requests.push(kw);
  });

  return categories;
}
```

### Step 2.2: Update Tool Orchestrator

Modify `src/backend/tools/index.ts` to use adapters:

```typescript
import { companyLookupAdapter } from "./adapters/companyLookup.adapter";
import { domainLookupAdapter } from "./adapters/domainLookup.adapter";
import { scamPatternDetectorAdapter } from "./adapters/scamPatternDetector.adapter";
import { ToolResult } from "@types/tool_results";

export class ToolOrchestrator {
  private cache = new Map<string, ToolResult>();
  private callCount = 0;
  private MAX_CALLS = 10;

  async execute(toolName: string, input: any): Promise<ToolResult> {
    // Check call budget
    if (this.callCount >= this.MAX_CALLS) {
      return {
        tool: toolName,
        success: false,
        error: `Tool budget exhausted (${this.MAX_CALLS} max calls per case)`,
      };
    }

    // Check cache
    const cacheKey = `${toolName}:${JSON.stringify(input)}`;
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cached: true };
    }

    // Execute tool
    this.callCount++;
    let result: ToolResult;

    switch (toolName) {
      case "lookup_company_registry":
        result = await companyLookupAdapter(input);
        break;
      case "lookup_domain_rdap":
        result = await domainLookupAdapter(input);
        break;
      case "detect_scam_patterns":
        result = await scamPatternDetectorAdapter(input);
        break;
      default:
        result = {
          tool: toolName,
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }

    // Cache result if successful
    if (result.success) {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  getCalls(): number {
    return this.callCount;
  }

  reset(): void {
    this.cache.clear();
    this.callCount = 0;
  }
}
```

---

## Phase 3: Foundry Agent Integration

### Step 3.1: Setup Foundry SDK

Install Foundry SDK (adjust based on actual package name):

```bash
npm install @microsoft/foundry-sdk
```

### Step 3.2: Define Tool Schemas for Foundry

Create `src/backend/agent/toolSchemas.ts`:

```typescript
export const toolSchemas = [
  {
    name: "lookup_company_registry",
    description: "Verify company existence and details via OpenCorporates",
    input_schema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Company name" },
        registration_number: {
          type: "string",
          description: "Company registration number",
        },
        country: {
          type: "string",
          description: "Company country code (e.g., US, GB)",
        },
      },
      required: [],
    },
  },
  {
    name: "lookup_domain_rdap",
    description: "Lookup domain WHOIS, DNS records, and metadata",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain name to lookup" },
      },
      required: ["domain"],
    },
  },
  {
    name: "detect_scam_patterns",
    description: "Analyze text for scam-related keywords and patterns",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to analyze for scam indicators",
        },
      },
      required: ["text"],
    },
  },
];
```

### Step 3.3: Create Foundry Agent Wrapper

Create `src/backend/agent/foundryAgent.ts`:

```typescript
import { FoundryClient } from "@microsoft/foundry-sdk"; // Adjust import based on actual SDK
import { toolSchemas } from "./toolSchemas";
import { ToolOrchestrator } from "../tools";

export class FoundryInvestigator {
  private foundry: FoundryClient;
  private toolOrchestrator: ToolOrchestrator;

  constructor(foundryProjectId: string, foundryApiKey: string) {
    this.foundry = new FoundryClient({
      projectId: foundryProjectId,
      apiKey: foundryApiKey,
    });
    this.toolOrchestrator = new ToolOrchestrator();
  }

  async investigate(evidence: string): Promise<any> {
    // Register tools with Foundry
    for (const schema of toolSchemas) {
      this.foundry.registerTool(schema, async (input) => {
        return await this.toolOrchestrator.execute(schema.name, input);
      });
    }

    // Invoke Foundry agent with system prompt and evidence
    const systemPrompt = `You are Verify My Interview, an AI fraud investigation agent.
    
    Your task is to analyze evidence about possible job or interview scams.
    
    Rules:
    - Never claim something is a scam without evidence
    - Use available tools to verify claims
    - Return reasoning as you investigate
    - Distinguish evidence from suspicion
    
    After investigation, summarize your findings.`;

    const response = await this.foundry.reasoning({
      systemPrompt,
      userMessage: evidence,
      tools: toolSchemas,
      maxToolCalls: 10,
      reasoning: "extended", // Use extended reasoning if available
    });

    return {
      reasoning: response.reasoning,
      conclusion: response.conclusion,
      toolsUsed: response.toolCallHistory,
      signals: this.extractSignals(response.reasoning),
    };
  }

  private extractSignals(reasoning: string): any {
    // Parse Foundry reasoning to extract verification signals
    // This is post-processing of agent output
    return {
      verified_facts: [], // Extract facts agent verified
      red_flags: [], // Extract concerns agent noted
      positive_signals: [], // Extract evidence supporting legitimacy
    };
  }
}
```

---

## Phase 4: Integration & Testing

### Step 4.1: Update Express Server

Modify `src/backend/server.ts`:

```typescript
import express from "express";
import { FoundryInvestigator } from "./agent/foundryAgent";
import { DeterministicScorer } from "./scorer/deterministic_scorer";
import { ReportWriter } from "./reporter/report_writer";
import { initializeDatabase } from "@infrastructure/db";

const app = express();
app.use(express.json());

let investigator: FoundryInvestigator;
const scorer = new DeterministicScorer();
const reporter = new ReportWriter();

app.post("/analyze", async (req, res) => {
  try {
    const { evidence } = req.body;

    if (!evidence) {
      return res.status(400).json({ error: "Evidence required" });
    }

    // Step 1: Run Foundry investigation
    const investigation = await investigator.investigate(evidence);

    // Step 2: Extract signals
    const signals = investigation.signals;

    // Step 3: Deterministic scoring
    const score = scorer.score(signals);
    const riskLevel = scorer.scoreToLevel(score);
    const confidence = scorer.calculateConfidence(signals);

    // Step 4: Generate report
    const report = reporter.generate({
      riskScore: score,
      riskLevel,
      confidence,
      signals,
      toolResults: investigation.toolsUsed,
      reasoning: investigation.reasoning,
    });

    res.json(report);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({ error: "Analysis failed" });
  }
});

app.listen(3000, async () => {
  await initializeDatabase();
  investigator = new FoundryInvestigator(
    process.env.FOUNDRY_PROJECT_ID!,
    process.env.FOUNDRY_API_KEY!,
  );
  console.log("Server running on port 3000");
});
```

### Step 4.2: Test with Existing Test Cases

Run test cases from `tests/test_cases/`:

```bash
npm test

# Individual test
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d @tests/test_cases/obvious_scam.json
```

---

## Phase 5: Deployment Considerations

### Database Setup

```bash
# MongoDB
docker run -d -p 27017:27017 mongo:latest

# Redis
docker run -d -p 6379:6379 redis:latest
```

Or use managed services:

- **MongoDB**: Atlas (cloud) or self-hosted
- **Redis**: ElastiCache (AWS) or Heroku Redis

### Environment Variables

```bash
# Database
MONGODB_URI=<connection-string>
REDIS_URL=<connection-string>

# External APIs
OPENCORPORATES_API_KEY=<key>
WHOIS_XML_API_KEY=<key>
ABSTRACT_API_KEY=<key>

# Foundry
FOUNDRY_PROJECT_ID=<id>
FOUNDRY_API_KEY=<key>

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

### Performance Notes

- **Tool caching**: Identical requests return cached results (1 hour for DNS/WHOIS, 7 days for company)
- **Tool budget**: Max 10 calls per case prevents runaway costs
- **Parallel execution**: Foundry agent can invoke tools in parallel (if SDK supports)
- **Timeout**: Set Foundry reasoning timeout to 30-60 seconds

---

## Rollback Strategy

If Foundry integration fails:

1. Keep legacy services in separate directory (`src/services/legacy/`)
2. Express server can fall back to direct service calls
3. Use existing ScamReport model to store investigations
4. Migrate incrementally instead of big-bang approach

**Incremental migration path:**

- Week 1: Get company lookup working
- Week 2: Add domain verification
- Week 3: Add scam pattern detection
- Week 4: Full integration testing
- Week 5: Production deployment

---

## Checklist

- [ ] Copy data files (scamKeywords.json, disposableDomains.json)
- [ ] Copy legacy services to src/services/legacy/
- [ ] Copy models to src/models/
- [ ] Setup database connections (MongoDB, Redis)
- [ ] Create adapter wrappers for all 6 tools
- [ ] Update ToolOrchestrator with adapters
- [ ] Define tool schemas for Foundry
- [ ] Implement FoundryInvestigator wrapper
- [ ] Update Express server
- [ ] Test with provided test cases
- [ ] Document API key requirements
- [ ] Setup deployment infrastructure
- [ ] Performance testing with concurrent requests
- [ ] Test fallback/error scenarios

---

## References

- **Existing services**: [See REUSABLE_COMPONENTS.md](./REUSABLE_COMPONENTS.md)
- **Tool specification**: [See TOOL_STRATEGY.md](./TOOL_STRATEGY.md)
- **Report schema**: [See REPORT_SCHEMA.md](./REPORT_SCHEMA.md)
- **Architecture**: [See SPEC.md](./SPEC.md)
