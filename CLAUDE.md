# Verify My Interview — Agent Operating Guide

AI fraud-investigation platform for job/interview scams (Agents League hackathon,
Microsoft Foundry track, submission due **2026-06-14**). Multi-agent pipeline +
deterministic scoring + scam-intelligence graph + Sentinel dark UI.

## Non-negotiable conventions

1. **Agents gather and vet evidence; the deterministic scorer sets the score.**
   The LLM never invents a risk number. Every signal carries `evidence.source`.
   New red signals must be mapped in `src/data/guidance.json` so reports cite
   official guidance (FTC/IC3/BBB).
2. **Graceful degradation.** Every external capability (Foundry, Search, OCR,
   Speech, WHOIS, Abstract APIs, SerpAPI/news) is env-key-gated and no-ops
   cleanly when unconfigured. `GET /health` reports each subsystem.
3. **Offline evals must stay deterministic.** Any NEW external call's env vars
   go into `SCRUBBED_ENV` in `src/backend/scripts/runEvals.ts`. Gate: `npm run
   eval` ⇒ **11/11** (plus any cases you add).
4. **Privacy (POPIA) by design.** Untrusted text is redacted at boundaries
   (`src/backend/privacy/redaction.ts` — SA IDs, bank/card numbers stripped;
   scam IOCs kept). Provider responses are data-minimized (no person names).
   Logs are content-free (`http/guard.ts` auditLog). See `docs/PRIVACY.md`.
5. **Security posture.** All endpoints: rate-limited, type/size-validated,
   magic-byte-sniffed uploads, sanitized external URLs (`sanitizeHttpUrl`),
   security headers + CSP. Don't weaken these to "make something work".
6. **Secrets.** Real keys live ONLY in `.env` (gitignored). Never in code,
   docs, tests, commits, or sub-agent prompts. `.env.example` documents names.
7. **Never auto-start servers** (user preference) — build/tests/evals are the
   verification path; ask before any live server run.
8. **Frontend = Sentinel design system** (`.claude/skills/sentinel-ui/SKILL.md`):
   dark security-SaaS, tokens like `surface`, `btn-primary`, `text-muted`,
   `ink-*`, `accent`; lucide-react icons; framer-motion; React escapes by
   default — never `dangerouslySetInnerHTML`.

## Safety-critical coding rules (NASA "Power of 10", TypeScript adaptation)

Apply to ALL new/modified code; reviewers reject violations:

1. **Simple control flow** — no `goto`-like tricks; no unbounded recursion
   (the entity-graph walkers use visited-sets + depth caps; keep it that way).
2. **Bounded loops** — every loop over external data has a hard upper bound
   (cap list lengths at parse time, `slice(0, N)` before iterating).
3. **Bounded allocation** — no unbounded buffering of untrusted input:
   size-capped uploads, length-capped strings/arrays (`cleanString`,
   `cleanStringArray`), capped graph growth.
4. **Short functions** — one screen (~60 lines) per function; split when bigger.
5. **Validate at boundaries** — assert/validate inputs at every trust boundary
   (HTTP body, provider response, env config) and fail with a typed error;
   inside the core, prefer invariants over defensive re-checks.
6. **Smallest scope** — `const` by default, no module-level mutable state
   except deliberate singletons (rate-limit buckets, graph store).
7. **Check every return** — no floating promises (`await` or `void` with a
   comment), no swallowed `catch` without a decision (log-and-degrade or rethrow).
8. **No metaprogramming** — no `eval`, no `Function()`, no dynamic `require`;
   `dangerouslySetInnerHTML` is banned in the frontend.
9. **Strict types** — no `any` in new code (use `unknown` + narrowing);
   `as` casts only at validated boundaries.
10. **Zero-warning policy** — `tsc` strict + `eslint` 0 errors are gates;
    warnings are debt, fix them in the same change.

## Verification gates (all must pass before any commit)

```
npm run build     # tsc backend + vite frontend
npm run lint      # eslint (0 errors)
npm test          # jest: unit + offline eval suites
npm run eval      # 11/11 offline, deterministic
git grep of real key fragments ⇒ empty
```

## Repo map (where things live)

- `src/backend/agent/` — orchestrator + 6 specialist agents (Foundry runner,
  deterministic fallbacks). `toolSchemas.ts` = function-tool contracts.
- `src/backend/scorer/` — `signalEngine.ts` (26+ signals) + deterministic scorer.
- `src/backend/tools/` — ToolOrchestrator + adapters (registry, RDAP, patterns,
  web research, phone intel).
- `src/backend/verification/providers.ts` — key-gated WHOIS/Abstract providers.
- `src/backend/network/` — Azure AI Search scam graph + seed ring + entity graph.
- `src/backend/http/guard.ts` — rate limits, headers, validators, sniffers.
- `src/backend/privacy/redaction.ts` — POPIA redaction.
- `src/backend/ocr/`, `src/backend/speech/` — DocIntel OCR, Azure Speech STT.
- `frontend/src/` — React+Vite SPA (pages, components, lib/api.ts).
- `tests/test_cases/*.json` — eval fixtures (synthetic only; SA-localized).
- `docs/` — ARCHITECTURE, PRIVACY, PRODUCTION_READINESS, REPORT_SCHEMA, SPEC.

## Tooling available to AGENTS (dev-time, NOT app runtime)

**PROACTIVE TOOLING MANDATE (do not wait to be reminded):** before starting any
task, check whether an installed skill, plugin, MCP server, or CLI already
covers it — and USE it automatically when relevant. Skills = instructions,
hooks = guardrails, MCP/CLI connections = abilities. Generic skills from other
projects (design, research, docs, deploy packs) are raw material: adapt their
rules to THIS app rather than ignoring them or following them blindly. When a
needed capability has no skill yet, consider writing one in `.claude/skills/`
so the next session inherits it. Sub-agent briefings must point at this section
so every future agent session knows the toolbox without being told.

**Skills (instructions):** `sentinel-ui` (frontend conventions) +
`impeccable-design` (design quality bar — use together), `threejs` (3D visuals,
Learn-Three.js-MCP prototyping loop), `deep-research` (budgeted research
protocol), `foundry-agents` (agent/tool patterns), `evidence-graph` (graph
schema/API), `demo-script` (video storyboard), `deploy-azure-foundry`
(deployment), `multi-agent-opus-orchestrator` (team coordination protocol).

**MCP servers (abilities):** Azure MCP + `az` CLI (logged in:
sub f85dbc26-…2813; resources in `rg-kkgawatlh9-6623` eastus2: Foundry
`verifymyinterview-resource`, Search `vmi-search-3907`, DocIntel
`vmi-docint-3907`); Microsoft Learn docs MCP (grounded Azure how-tos);
Playwright MCP / Claude Preview / Chrome tools (drive + screenshot the UI);
Higgsfield MCP (AI video/image generation — demo-video assets); GitHub via
`gh` CLI.

**Hooks (guardrails):** configured in `.claude/settings.json` if present —
they intercept tool calls; treat hook output as user feedback, don't fight it.

## Current state (2026-06-11)

Shipped: 6-agent pipeline, entity graph + seeded ring, Sentinel UI, guidance
citations, PII redaction (now applied at the `/analyze` boundary for ALL
evidence channels), real external verification (WHOIS/Abstract/news), HTTP
hardening (rate limits/validation/CSP/audit log), full Voice Investigation
(record/upload → `/transcribe` Azure Speech → editable transcript → pipeline;
report read-back via browser TTS), voice design doc. Gates: lint 0/0,
jest 21/21, evals 11/11, npm audit 0.
Open: live Azure rehearsal (incl. AZURE_SPEECH_* keys + webm/opus check),
demo video, submission packaging.

Orchestration state lives in `.claude/orchestrator/PROJECT_STATE.md`
(decisions D1–D4, requirements coverage, risks) — read it before resuming work.
