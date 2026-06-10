# Verify My Interview

An AI fraud investigation agent built with Microsoft Foundry to detect suspicious job offers and interview scams.

## Overview

Verify My Interview uses multi-step reasoning and external verification tools to analyze evidence about potential job or interview scams. Instead of relying on pattern matching alone, it verifies claims against real-world data (company registries, domain records, DNS checks, URL reputation) and produces an explainable risk report.

## One-Sentence Pitch

Verify My Interview uses a Microsoft Foundry reasoning agent to investigate suspicious job offers step by step, verify real-world evidence with tools, and produce an explainable scam-risk report that helps job seekers avoid fraud.

## Project Structure

```
Verify My Interview/
├── README.md                 # This file
├── docs/                     # Documentation
│   ├── SPEC.md              # Full system specification
│   ├── ARCHITECTURE.md      # System architecture
│   ├── AGENT_INSTRUCTIONS.md # Agent guidelines
│   ├── TOOL_STRATEGY.md     # Tool call strategy
│   └── REPORT_SCHEMA.md     # Output report schema
├── src/
│   ├── backend/
│   │   ├── tools/           # External verification tools
│   │   │   ├── company_registry.ts
│   │   │   ├── domain_rdap.ts
│   │   │   ├── dns_checks.ts
│   │   │   ├── url_reputation.ts
│   │   │   ├── web_reputation.ts
│   │   │   ├── scam_patterns.ts
│   │   │   └── index.ts
│   │   ├── agent/           # Foundry reasoning agent
│   │   │   ├── instructions.ts
│   │   │   └── orchestrator.ts
│   │   ├── scorer/          # Risk scoring logic
│   │   │   └── deterministic_scorer.ts
│   │   ├── reporter/        # Report generation
│   │   │   └── report_writer.ts
│   │   └── server.ts        # Express API server
│   ├── types/
│   │   ├── entities.ts      # Data structures
│   │   ├── report.ts        # Report schema
│   │   └── tool_results.ts  # Tool return types
│   └── utils/
│       ├── parser.ts        # Evidence parser
│       └── validators.ts    # Input validation
├── tests/
│   ├── test_cases/          # Test scenarios
│   │   ├── obvious_scam.json
│   │   ├── company_impersonation.json
│   │   ├── legitimate_job.json
│   │   ├── low_evidence.json
│   │   └── inconclusive.json
│   └── unit/
│       ├── tools.test.ts
│       ├── scorer.test.ts
│       └── parser.test.ts
├── package.json
├── tsconfig.json
└── .env.example
```

## Key Features

- **Multi-Step Reasoning**: Uses Foundry reasoning agent to plan and execute verification steps
- **External Verification**: Checks company registries, domain records, DNS, URL reputation
- **Deterministic Scoring**: Combines verified signals into a transparent risk score
- **Explainable Output**: Each risk factor is traced to tool results and reasoning steps
- **Privacy-Safe**: No sensitive data in logs, respects user privacy

## Risk Levels

- **Low Risk**: Strong verification, legitimate signals
- **Needs More Verification**: Mixed signals, missing evidence
- **Suspicious**: Multiple red flags, inconsistencies
- **Likely Scam**: Strong evidence of scam patterns
- **Inconclusive**: Insufficient evidence to assess

## Implementation Priority

1. Backend tools setup (company lookup, domain checks, etc.)
2. Define OpenAPI/function schemas
3. Create Foundry reasoning agent
4. Connect Express server to agent
5. Add deterministic scorer
6. Add report writer
7. Add traces and evaluation cases

## Demo Workflow

1. User uploads suspicious interview email and messages
2. Agent extracts company, recruiter email, payment request, URL
3. Agent calls tools in sequence:
   - Company registry lookup
   - Domain RDAP check
   - DNS record verification
   - Scam pattern detection
   - Web reputation search
4. Agent produces risk report with score, confidence, and reasoning

## Development

See individual documentation files in `docs/` for:

- Full specification and design decisions
- Tool schemas and API contracts
- Agent instructions and reasoning rules
- Test case definitions

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Build + run server
npm run build && npm start
# or, for development with reload:
npm run dev
```

Send a case to the agent:

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"evidence":"Pay a $200 upfront training fee via gift card to start your remote job. Urgent!"}'
```

## Microsoft Foundry Setup

The reasoning agent runs on **Microsoft Foundry (Azure AI Foundry) Agent Service**
via the `@azure/ai-agents` SDK. Authentication uses **Microsoft Entra ID**
(`DefaultAzureCredential`) — there is no API key.

1. Create a Foundry project and deploy a model (e.g. `gpt-4o`).
2. Sign in locally so the SDK can get a token:

   ```bash
   az login
   ```

3. Configure `.env`:

   ```bash
   AZURE_AI_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
   AZURE_AI_MODEL_DEPLOYMENT=gpt-4o
   ```

How it runs:

- **Endpoint set** → the agent investigates with multi-step reasoning, calling the
  verification tools (`lookup_company_registry`, `lookup_domain_rdap`,
  `detect_scam_patterns`) through Foundry's function-calling loop.
- **Endpoint blank** → the app automatically uses a built-in **deterministic
  engine** so it stays demoable without an Azure subscription. The response's
  `engine` field (and server logs) indicate which path ran.

> Note: `src/infrastructure/db.ts` (MongoDB/Redis) is unused scaffolding and is
> excluded from the build. The verification services cache in-memory; wire it up
> and `npm i mongoose redis` only if you adopt an external cache.

## License

MIT
