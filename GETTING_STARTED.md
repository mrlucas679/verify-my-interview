# Getting Started

## Project Overview

You now have a well-organized project structure for **Verify My Interview**, an AI fraud investigation agent for job interview scams.

## What's Been Set Up

### 📁 Directory Structure

```
Verify My Interview/
├── docs/                    # Complete documentation
│   ├── SPEC.md             # Full system specification
│   ├── AGENT_INSTRUCTIONS.md # Agent decision rules
│   ├── TOOL_STRATEGY.md    # Tool implementation guide
│   └── REPORT_SCHEMA.md    # Output format examples
├── src/
│   ├── backend/
│   │   ├── tools/          # Tool orchestration
│   │   ├── agent/          # Agent orchestrator (Foundry integration)
│   │   ├── scorer/         # Risk scoring logic
│   │   ├── reporter/       # Report generation
│   │   └── server.ts       # Express API
│   ├── types/              # TypeScript definitions
│   └── utils/              # Helpers (parser, validators)
├── tests/
│   ├── test_cases/         # 4+ test scenarios
│   └── unit/               # Unit test placeholders
├── package.json            # Dependencies
├── tsconfig.json           # TypeScript config
├── README.md               # Project overview
└── .gitignore
```

### 📚 Documentation Files

1. **SPEC.md** - Complete specification with data flows, design decisions, implementation priority
2. **AGENT_INSTRUCTIONS.md** - Core rules, reasoning steps, tool strategy
3. **TOOL_STRATEGY.md** - Detailed tool schemas, orchestration flow, implementation checklist
4. **REPORT_SCHEMA.md** - Output JSON format with 3 complete examples

### 🧪 Test Cases

Pre-built test scenarios in `tests/test_cases/`:

- ✅ `obvious_scam.json` - Google impersonation with payment request
- ✅ `legitimate_job.json` - Real Microsoft job posting
- ✅ `suspicious_mixed.json` - Mixed signals requiring more verification
- ✅ `inconclusive.json` - Insufficient evidence

## Next Steps

### 1. Review Documentation

Start here to understand the complete system design:

```bash
# Read in this order:
cat docs/SPEC.md
cat docs/AGENT_INSTRUCTIONS.md
cat docs/TOOL_STRATEGY.md
cat docs/REPORT_SCHEMA.md
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Choose Your First Task

Pick one from the priority list:

**Option A: Implement Backend Tools (6-8 hours)**

- Implement tool stubs in `src/backend/tools/`
- Add mock tool providers for testing
- Create tool integration tests

**Option B: Build Agent Orchestrator (4-6 hours)**

- Implement evidence parser (`src/utils/parser.ts`)
- Build agent orchestrator (`src/backend/agent/orchestrator.ts`)
- Integrate with Foundry API

**Option C: Implement Deterministic Scorer (2-3 hours)**

- Implement scoring rules in `src/backend/scorer/deterministic_scorer.ts`
- Tune weights based on test cases
- Add scoring unit tests

**Option D: Complete Express Server (2-3 hours)**

- Implement `/analyze` endpoint fully
- Add error handling and logging
- Set up health checks and monitoring

### 4. Development Commands

```bash
# Start development server with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start

# Run tests
npm test

# Watch tests during development
npm run test:watch

# Lint code
npm run lint

# Format code
npm run format
```

## Architecture Overview

```
User Evidence
    ↓
[Express Server] POST /analyze
    ↓
[Evidence Parser] Extract entities (company, email, domain, URL, etc.)
    ↓
[Agent Orchestrator] Plan tool calls (reasoning step)
    ↓
[Tool Orchestrator] Execute tools with caching & budget
    ├─ lookup_company_registry
    ├─ lookup_domain_rdap
    ├─ lookup_dns_records
    ├─ check_url_reputation
    ├─ detect_scam_patterns
    └─ search_reputation_web (optional)
    ↓
[Signal Normalizer] Convert tool results to standardized signals
    ↓
[Deterministic Scorer] Calculate risk score 0-100 and confidence
    ↓
[Report Writer] Format output as JSON report
    ↓
JSON Risk Report (score, level, confidence, red flags, next steps)
```

## Key Design Principles

1. **Evidence-Based**: Never claim a scam without tool-backed evidence
2. **Deterministic**: Final score is explainable (not ML-based)
3. **Conservative**: Lower confidence when evidence is missing
4. **Private**: No sensitive data in logs
5. **Scalable**: Tool budget, caching, and rate limit aware

## File Descriptions

| File                                         | Purpose                                     |
| -------------------------------------------- | ------------------------------------------- |
| `src/backend/server.ts`                      | Express API server with `/analyze` endpoint |
| `src/backend/agent/orchestrator.ts`          | Coordinates the investigation pipeline      |
| `src/backend/tools/index.ts`                 | Tool orchestrator with caching & budget     |
| `src/backend/scorer/deterministic_scorer.ts` | Risk scoring logic                          |
| `src/backend/reporter/report_writer.ts`      | Report formatting                           |
| `src/utils/parser.ts`                        | Evidence parser (entity extraction)         |
| `src/types/*.ts`                             | TypeScript interfaces                       |
| `tests/test_cases/*.json`                    | Test scenarios                              |

## Questions?

Refer to:

- **Design questions** → `docs/SPEC.md`
- **Tool implementation** → `docs/TOOL_STRATEGY.md`
- **Output format** → `docs/REPORT_SCHEMA.md`
- **Agent rules** → `docs/AGENT_INSTRUCTIONS.md`

Good luck! 🚀
