# Verify My Interview - Handoff Report

Generated: 2026-06-12

This report reconstructs the project state from the repository itself: source,
docs, config, tests, local Git metadata, and project context files. It does not
use prior AI conversation history. I inspected the local `.env` only for key
presence and did not copy any secret values.

## Executive Summary

Verify My Interview is a Node/TypeScript fraud-intelligence platform for
job/interview scams. It combines a Microsoft Foundry-oriented multi-agent
investigation pipeline, deterministic evidence scoring, a scam-intelligence
entity graph, OCR intake, voice transcription intake, official guidance
citations, and a React/Vite "Sentinel" UI.

The current codebase is functional and verification gates are green in offline
deterministic mode. The repo is not clean: there are uncommitted changes in
scoring, parser, web research, agent summaries, guidance, and one scorer test,
plus untracked `AGENTS.md` and `.agents/`.

The strongest current state is: backend build passes, frontend typecheck/build
passes, lint passes, Jest passes 25/25, offline evals pass 12/12, the agent
stress harness passes 13/13 offline, a limited live stress subset passes 2/2 in
mixed engine mode, targeted live red-team replays pass 4/4, and production
dependency audits are clean. The largest
risks are not basic deterministic correctness; they are live Foundry stage
completion, production hardening, broader live end-to-end verification, doc
drift, local dev proxy drift, missing route/audio tests, and a few stale/legacy
code paths.

## Repository And Git State

- Repository path: `C:\Users\Admin\OneDrive\Documents\New folder\Verify My Interview`
- Remote: `https://github.com/mrlucas679/verify-my-interview.git`
- Current branch: `codex/safe-work-20260612`
- HEAD: `13ebc6e Fix voice in browser: allow mic via Permissions-Policy, map Azure errors, 404 stale assets`
- Local branch aligns with `origin/feat/voice-investigation-hardening`.
- `main` is behind by 2 commits.

Uncommitted tracked files:

- `package.json`
- `src/backend/agent/agents/evidenceAgent.ts`
- `src/backend/agent/agents/networkAgent.ts`
- `src/backend/agent/agents/researchAgent.ts`
- `src/backend/agent/humanize.ts`
- `src/backend/agent/orchestrator.ts`
- `src/backend/research/webResearch.ts`
- `src/backend/scorer/deterministic_scorer.ts`
- `src/backend/scorer/signalEngine.ts`
- `src/backend/tools/adapters/webResearch.adapter.ts`
- `src/data/guidance.json`
- `src/utils/parser.ts`
- `tests/unit/scorer.test.ts`

Untracked project context:

- `AGENTS.md`
- `.agents/`
- `.codex/`
- `HANDOFF_REPORT.md`
- `docs/EVALUATION_STRATEGY.md`
- `docs/AGENT_STRESS_TEST_RESULTS.md`
- `src/backend/scripts/stressAgents.ts`

Recent commit story:

- `13ebc6e`: browser voice fixes: mic `Permissions-Policy`, Azure speech error mapping, stale asset 404s.
- `b02fbf6`: production pass: error boundary, dead-code removal, readiness status.
- `1d5570c` / `5b54f9b`: final two-page UI and report polish.
- Earlier commits added voice, web/news research, real verification providers,
  privacy hardening, eval corpus, guidance citations, entity graph, and the
  original six-agent platform.

## Validation Results

Commands run successfully on 2026-06-12:

- `npm run build:backend`: pass
- `npm run lint`: pass
- `npm test`: pass, 4 suites, 25 tests
- `npm --prefix frontend run typecheck`: pass
- `npm --prefix frontend run build`: pass
- `npm run eval`: pass, 12/12 offline deterministic cases
- `npm run stress:agents`: pass, 13/13 offline deterministic stress checks
- `npm run stress:agents -- --live --limit=2`: pass, 2/2 mixed live/provider
  stress checks
- `npm run stress:agents -- --live --case=paid-training`: pass, targeted
  paid-training false-positive control
- `npm run stress:agents -- --live --case=starter-kit`: pass, targeted
  starter-kit payment false-negative control
- `npm run stress:agents -- --live --case=otp`: pass, targeted OTP
  credential-harvest control
- `npm run stress:agents -- --live --case=personal-bank-account`: pass,
  targeted money-mule control, with Foundry investigator fallback observed
- `npm audit --omit=dev`: 0 vulnerabilities
- `npm --prefix frontend audit --omit=dev`: 0 vulnerabilities
- `npm audit`: 0 vulnerabilities

Frontend full dev audit:

- `npm --prefix frontend audit`: 2 moderate dev-only advisories through
  `vite`/`esbuild`. The audit suggests a breaking upgrade to Vite 8. Production
  dependencies audit clean.

Frontend build warning:

- Main JS chunk is about 537 kB after minification. This is performance debt,
  likely from graph/animation dependencies, not a build blocker.

Latest offline eval results:

| Case | Level | Score | Result |
|---|---:|---:|---|
| Header-spoofed corporate email | Likely Scam | 77 | PASS |
| Inconclusive - Insufficient Evidence | Inconclusive | 0 | PASS |
| Legitimate Job - Microsoft | Low Risk | 0 | PASS |
| Obvious Scam - Google Impersonation | Likely Scam | 100 | PASS |
| Ring-linked offer | Likely Scam | 100 | PASS |
| SA brand-impersonation via job aggregator | Needs More Verification | 17 | PASS |
| SA document-harvest via free-host link | Suspicious | 59 | PASS |
| Legitimate SA youth learnership | Low Risk | 12 | PASS |
| Legitimate recruiter on unusual TLD | Low Risk | 12 | PASS |
| SA SMS reply-bait | Needs More Verification | 18 | PASS |
| SA upfront-fee + WhatsApp-only retail scam | Suspicious | 50 | PASS |
| Suspicious - Mixed Signals | Suspicious | 55 | PASS |

## Application Purpose

The product helps job seekers evaluate suspicious interviews, job ads, and
offers. The central product claim is evidence-backed risk assessment, not
accusation. A real company name is treated as insufficient proof of legitimacy;
the system verifies recruiter channels, email headers, domains, payment flows,
public research, and reused scam infrastructure.

The project is framed as a Microsoft Agents League / Microsoft Foundry
hackathon submission due 2026-06-14.

## Architecture

Runtime shape:

- Backend: Express 4, TypeScript, CommonJS build to `dist/`.
- Frontend: React 18, Vite, Tailwind, Framer Motion, lucide-react,
  react-force-graph-2d.
- Deployment: backend serves the built SPA from `public/`; Dockerfile uses a
  Node 20 Alpine multi-stage build.
- Foundry auth: `DefaultAzureCredential`, controlled by
  `AZURE_AI_PROJECT_ENDPOINT` and `AZURE_AI_MODEL_DEPLOYMENT`.

Primary pipeline in `src/backend/agent/orchestrator.ts`:

1. Evidence agent: deterministic entity extraction and raw email header parsing.
2. Investigator agent: optional Foundry planning plus verification tools, with
   deterministic fallback.
3. Research agent: optional SerpAPI/NewsAPI/GNews web research.
4. Network agent: Azure AI Search semantic matches plus deterministic entity
   graph structural matches.
5. Verifier/Critic agent: optional Foundry critique, deterministic fallback.
6. Reporter agent: optional Foundry narrative, deterministic fallback.

Scoring:

- Live scoring path is `deriveSignals()` in `src/backend/scorer/signalEngine.ts`
  plus `scoreStructuredSignals()` in
  `src/backend/scorer/deterministic_scorer.ts`.
- Agents gather and narrate evidence; they do not set the score.
- Every structured signal has an id, label, category, signed points, and
  evidence source/detail.

Network:

- Azure AI Search index default: `scam-reports-v2`.
- Embeddings: Azure OpenAI embedding deployment, default
  `text-embedding-3-small`.
- Fallback: in-memory graph from `src/backend/network/seedData.ts`.
- Seed corpus: 32 synthetic reports, including a Nimbus Talent ring that
  reuses domains, emails, phone, USDT wallet, and Zelle handle across multiple
  impersonated brands.
- Trust levels: `unverified`, `verified`, `corroborated`, `trusted`.

Frontend:

- Routes: `/` and `/report`.
- `/` is the intake surface with paste, upload, and voice modes.
- `/report` displays verdict, investigation layers, score signals, graph,
  official guidance, next steps, missing evidence, and detective chat.
- There is no persisted client-side case history. Refreshing loses the active
  report because state lives in React context.

## Implemented Features

Backend endpoints:

- `POST /analyze`: validates evidence, redacts sensitive identifiers, runs the
  pipeline, returns report, trace, structured signals, matches, and graph.
- `POST /upload`: OCR for screenshots/PDFs using Azure Document Intelligence,
  key-gated, 8 MB cap, magic-byte sniffing.
- `POST /transcribe`: Azure AI Speech Fast Transcription, key-gated, 25 MB cap,
  6/min/IP rate limit, magic-byte audio sniffing, no raw audio persistence.
- `POST /chat`: case-aware detective with optional Foundry and graph lookup.
- `POST /report`: submit a scam report to the intelligence network; optional
  API-key gate with `VMI_REPORT_API_KEY`.
- `GET /network/graph`: full/filterable entity graph.
- `GET /network/stats`: aggregate threat stats.
- `GET /health`: subsystem flags.
- `GET /docs`: endpoint documentation.

Detection and scoring signals include:

- Up-front payment request.
- Training/registration fee narrative.
- Credential or sensitive-detail requests.
- Reply-To mismatch.
- SPF/DMARC failures.
- Free-mail corporate claim.
- New/recent domain, no MX, disposable domain, risky TLD, high-risk email/domain.
- Proxy/hosting sender IP.
- Phone VOIP/high-risk flags.
- Company registry positive/negative.
- Public scam warnings or official listing found.
- Lookalike domain.
- Unofficial application channel: aggregator, free host, link shortener.
- SMS reply-bait smishing.
- WhatsApp-only application.
- Offer/onboarding with no interview step.
- Semantic and structural network matches.

Privacy and security controls:

- POPIA-oriented redaction at `/analyze` and `/report` boundaries.
- Redacts SA ID numbers, payment card numbers, and bank account numbers in
  account context.
- Preserves scam indicators such as recruiter email, domain, phone, and payment
  handle.
- Upload/audio magic-byte sniffing, not client MIME trust.
- Endpoint size caps and per-route rate limits.
- Security headers and CSP.
- Content-free audit logging with salted IP hash.
- External provider payload sanitization and URL scheme allowlisting.
- No raw audio persistence.

External integrations:

- Microsoft Foundry Agent Service via `@azure/ai-agents`.
- Azure AI Search.
- Azure OpenAI embeddings.
- Azure AI Document Intelligence.
- Azure AI Speech Fast Transcription.
- SerpAPI, NewsAPI, GNews.
- WHOIS via who-dat and whoisjson fallback.
- Abstract Email Reputation, Phone Intelligence, Company Enrichment, and IP
  Intelligence.
- Legacy OpenCorporates service.

Local `.env` key presence:

- Foundry, Azure OpenAI, Search, Document Intelligence, Speech, WHOIS, Abstract,
  NewsAPI, GNews, SerpAPI, and server keys are set locally.
- `OPENCORPORATES_API_KEY`, `WHOIS_XML_API_KEY`, and legacy `ABSTRACT_API_KEY`
  are empty.
- `GOOGLE_MAPS_API_KEY` is set locally but is not documented in `.env.example`
  and no usage was found in the inspected source.

## Current Uncommitted Work

The working tree changes look like a recent recall/readability hardening pass:

- Humanized evidence summaries for domain and network findings.
- Safer web research classification:
  - scam-warning result cannot also count as an official listing;
  - scam mention must mention the company token;
  - official listing and scam mention URLs are kept separately.
- Scoring update:
  - semantic-only network matches are dampened for verified-legit cases with
    strong green signals and no scam mechanics;
  - confidence caps at 0.95;
  - sparse network-only cases cannot read as Low Risk.
- New `training_fee_narrative` signal for spoken/narrative fee phrasing.
- Parser improvements:
  - excludes IP addresses from phone extraction;
  - recognizes "company called/name is" voice transcript phrasing;
  - adds known-brand extraction for major impersonation targets.
- Guidance now maps `training_fee_narrative` to FTC job scam guidance.
- Scorer test added for semantic damping on verified-legit cases.
- Agent stress harness added as `npm run stress:agents`.
- Stress harness now supports `--case=<substring>` targeted replay.
- Stress fixes added for deadline-pressure language and stronger standalone
  upfront-payment scoring.
- Red-team stress fixes added for negated fee language, paid stipend false
  positives, starter-kit/uniform purchase demands, banking-app OTP credential
  harvesting, and personal-bank-account money-mule requests.

These changes are validated by the current build/lint/test/eval/stress runs but
are not committed.

## Partially Complete Or Risky Areas

Foundry live behavior:

- Foundry integration exists. A limited live/provider stress run passed 2/2 in
  `mixed` engine mode, and targeted live red-team replays passed 4/4. Logs
  still showed at least one Foundry investigator run ending `incomplete` and
  falling back to deterministic logic.
- Agent output JSON is parsed best-effort. Strict schema validation with
  deterministic fallback is still a production-readiness item.
- Report/chat grounding through Foundry IQ or Azure AI Search knowledge-base
  citations is planned, not implemented as a managed Foundry tool flow.

Company registry:

- `CompanyVerificationService.lookupByName()` only runs when `country` is
  supplied.
- The deterministic investigator passes `company_name` without a country, so
  company lookup commonly returns "Company not found" even for known names.
- This affects tool coverage, trace usefulness, and potential signals.

Local dev workflow:

- `frontend/vite.config.ts` defaults proxy backend to port 4000, while root
  `npm run dev` starts Express on 3000 unless `PORT` is set.
- Vite proxy only includes `/analyze` and `/health`; it omits `/upload`,
  `/transcribe`, `/chat`, `/report`, and `/network/*`.
- Production static serving works, but split dev mode is incomplete.

Testing gaps:

- No unit tests for `sniffAudioType`.
- No route tests for `/transcribe` 400/413/415/422/503 mappings.
- No route tests for `/upload`, `/analyze` validation/redaction, `/chat`
  validation, or `/report` API-key behavior.
- Parser improvements for voice company names and IP-not-phone behavior need
  direct unit coverage.
- Live Azure/Search/Speech/OCR paths are not covered by automated tests.
- The current eval harness scores final pipeline outcomes, and the new stress
  harness now adds workflow/tool/safety assertions. It still needs deeper
  per-agent live trace scoring, safety/adversarial route tests, efficiency
  metrics, and production outcome measurement. See
  `docs/EVALUATION_STRATEGY.md` and `docs/AGENT_STRESS_TEST_RESULTS.md`.

Docs drift:

- README says 11/11 evals; current evals are 12/12.
- `CLAUDE.md` / `AGENTS.md` say Jest 24/24; current Jest is 25/25.
- `GETTING_STARTED.md` still mentions 6/6 scenarios.
- `docs/ARCHITECTURE.md` omits voice in the intake diagram and describes an
  Intelligence Network page, but the frontend currently has only `/` and
  `/report`.
- `docs/VOICE_INVESTIGATION_DESIGN.md` references `frontend/src/pages/NewCase.tsx`;
  the actual page is `frontend/src/pages/Verify.tsx`.
- The voice doc marks some items as next that are already implemented
  (`AZURE_SPEECH_*` scrubbed, 25 MB route-specific 413), while audio sniff unit
  tests remain missing.
- `docs/MIGRATION_GUIDE.md` reflects an older MongoDB/Redis/API-key migration
  plan and is not the current architecture.

Legacy/dead code (UPDATED 2026-06-16 — both prior bullets were stale):

- `DeterministicScorer.score()/explainScore()` is now fully implemented as a
  legacy `SignalSet → StructuredSignal` adapter and is covered by
  `tests/unit/scorer.test.ts` ("DeterministicScorer legacy adapter"). The live
  pipeline scores via `deriveSignals` + `scoreStructuredSignals` directly; the
  class is retained for the legacy adapter contract, not a TODO stub.
- `src/infrastructure/db.ts` no longer exists — there is no MongoDB/Redis code
  in the tree. State is Azure AI Search + in-memory entity graph only.

Operational hardening:

- AuthN/AuthZ is not implemented for public intake endpoints.
- Rate limiting is in-memory and per process; production scale-out needs a
  shared store.
- `/report` API key is optional and disabled when `VMI_REPORT_API_KEY` is unset.
- No production retention job, user consent UX, objection/correction/delete
  channel, face blurring, or Information Officer process is implemented.
- Secrets are local `.env` values; production should use Key Vault/managed
  identity.
- Current docs mention East US/East US 2 Azure resources; production SA service
  still needs South Africa North/data-residency decisions.

## Deployment Status

The code is deployable as a container:

- `Dockerfile` builds backend and frontend, then runs
  `node dist/src/backend/server.js`.
- `PORT` is read from the environment.
- Express serves `public/`.
- `.dockerignore` excludes docs, tests, markdown, env files, `public`, `dist`,
  and dependencies.

Project docs and skills describe Azure Container Apps deployment and managed
identity access to Foundry. The repo-level project state says remaining live
steps are:

- Run `npm run seed:network` for the v2 Azure Search index.
- Start fresh terminal/session so `DefaultAzureCredential` can find Azure CLI
  credentials.
- Verify browser MediaRecorder WebM/Opus against `/transcribe`.
- Record demo video and package submission.

This handoff did not start a server. It did perform a limited live/provider
agent stress subset, which passed 2/2 in mixed mode but exposed Foundry
`incomplete` fallback behavior that still needs debugging.

## Recommended Next Steps

1. Decide what to do with the dirty working tree.
   Review and commit or intentionally discard the uncommitted scoring/parser/
   research/readability changes. Also decide whether `AGENTS.md` and `.agents/`
   should be committed. The skill files in `.agents` are not all byte-identical
   to `.claude`, so do not blindly delete either copy without comparing intent.

2. Fix local development drift.
   Update `frontend/vite.config.ts` to proxy all API routes and align the
   default backend port with `npm run dev`, or document the required
   `BACKEND_PORT`/`PORT` pairing.

3. Update docs to current reality.
   Normalize eval/test counts to 12/12 and 25/25, update voice references from
   `NewCase.tsx` to `Verify.tsx`, document full web/news providers and voice,
   and mark obsolete migration content as historical.

4. Add missing safety tests.
   Cover `sniffAudioType`, `/transcribe` error statuses, `/upload` sniffing
   route behavior, `/analyze` redaction, `/report` API-key gate, and parser
   cases for voice/narrative company extraction and IP-address exclusion.

5. Fix live Foundry stage completion.
   The limited live stress subset passes through deterministic fallback, but
   Foundry stages can still end `incomplete`. Capture required actions, run
   status details, tool-call handoff failures, and model/deployment errors per
   stage, then make the smoke stress run complete without fallback.

6. Expand the eval harness beyond current stress coverage.
   Add deeper per-agent live trace scoring, strict stage-schema validation,
   provider mocks, safety/adversarial route tests, efficiency metrics, and
   production eval categories as described in `docs/EVALUATION_STRATEGY.md` and
   `docs/AGENT_STRESS_TEST_RESULTS.md`.

7. Fix company lookup semantics.
   Either infer/default country safely, make country extraction explicit, add
   provider support that can search without country, or stop counting company
   registry as a core coverage expectation when no country is available.

8. Run live end-to-end rehearsal.
   With real env vars active, run Search seeding, start the built server,
   inspect `/health`, analyze the ring sample, test `/upload`, test browser
   WebM/Opus `/transcribe`, test `/chat`, and update `PROJECT_STATE.md` with
   exact results.

9. Production hardening sprint.
   Add auth/quotas, Prompt Shields, strict output-schema validation, redacted
   structured telemetry, Key Vault/managed identity, retention/rights workflow,
   and SA-region/data-residency decisions.

10. Performance and dependency cleanup.
   Code-split the graph/report bundle to reduce the 537 kB JS chunk. Plan the
   Vite/esbuild dev advisory upgrade after submission or explicitly accept the
   risk with the current production-serving rationale.

11. Detection roadmap after submission.
   Implement SA employer allowlists, shortener/redirect unwrapping, template
   fingerprinting, stale-date/internal inconsistency checks, and a larger
   labelled synthetic/real-private eval corpus with explicit false-positive
   metrics.

## Bottom Line

The project is in a strong hackathon-submission state: the core offline
pipeline, UI, graph, voice intake, privacy boundary, and eval harness are all
working. The immediate engineering priority is to stabilize the current
uncommitted changes, fix doc/dev workflow drift, add missing tests around voice
and HTTP safety, and perform one real Azure browser rehearsal before packaging.
