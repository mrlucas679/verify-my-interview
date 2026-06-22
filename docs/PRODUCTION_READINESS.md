# Production Readiness & Hardening Plan

What it takes to turn this hackathon build into a service real job seekers can
rely on. Grouped by theme, each item marked **[done]**, **[next]** (the first
production sprint), or **[later]**. The ordering inside each section is by
priority.

The guiding principle is already in the architecture and must not regress:
**agents gather and vet evidence; a deterministic scorer sets the risk; every
claim cites a source.** Hardening makes that pipeline grounded, safe, measured,
and operable — it does not move scoring into the model.

## Launch status (2026-06-22)

The app has moved from the hackathon two-page demo shape to the current
AI-first product shape:

- `/` is the single Investigation Workspace with one multimodal composer for
  pasted evidence, files, voice, check mode, and report mode.
- Verify results render as stacked investigation cards.
- Report mode returns an acknowledgment/reference id only.
- `/history` replaces the old community/network screen.
- `/network` redirects to `/history`.
- The public frontend graph UI and `react-force-graph-2d` dependency are gone;
  prior report matches now render as plain "Similar reports" cards.
- Env-gated Entra PKCE sign-in, account menu, redacted case history, evidence
  consent, POPIA erasure, and admin report moderation are implemented in the
  product surface.

Latest full product gate:

- `npm --prefix frontend run typecheck`: pass.
- `npm run build`: pass.
- `npm run lint`: pass.
- `npm test`: pass, 26 suites / 165 tests.
- `npm run eval`: pass, 13/13.
- `npm run stress:agents`: pass, 13/13.
- `npm run audit:prod`: pass, 0 production vulnerabilities. It tries the live
  npm registry first and falls back to cached offline audit only when the
  registry is unavailable in the local environment.

Known launch caveats:

- `npm run azure:doctor -- --require-live` is not ready in the current terminal:
  `APPLICATIONINSIGHTS_CONNECTION_STRING` is missing, Azure CLI is unavailable
  or not logged in, and Azure Search is not configured in the process.
- Public beta still requires the external P1 launch blockers in
  [`LIVE_LAUNCH_CHECKLIST.md`](LIVE_LAUNCH_CHECKLIST.md): live Entra tenant/app
  provisioning, admin role assignment, POPIA contact/Information Officer route,
  production telemetry, durable storage configuration, and live smoke tests
  against the deployed URL.

---

## 1. Grounding the model (accuracy + traceability)

The reasoning agents must answer from real evidence, not training-data priors.

- **[done]** Deterministic signal engine + scorer own the score; the LLM never
  invents a risk number. Each signal carries `evidence.source`.
- **[done]** Critic stage strikes any claim no successful tool result supports
  (`removed_claims`), and a deterministic fallback runs when Foundry is absent.
- **[next]** **Ground the report/chat agents in a knowledge base** of scam
  guidance (FTC / IC3 / SAPS / SAFPS / BBB + our own taxonomy) using the
  **Azure AI Search tool for Foundry agents**, which returns inline citations in
  the `[idx†source]` form. A `vmi-search` service is already provisioned. Prefer
  the managed **Foundry IQ** knowledge-base experience if available.
  Docs: [AI Search tool](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/ai-search) ·
  [Foundry IQ](https://learn.microsoft.com/azure/foundry/agents/how-to/foundry-iq-connect)
- **[next]** **Strict output-schema validation.** The report is already a typed
  object; validate the agent's JSON against the schema and fall back to the
  deterministic narrative on any deviation, so a malformed/hallucinated field
  can never reach the user.
- **[later]** **Groundedness detection** (Azure AI Content Safety) on the
  generated narrative to flag/correct ungrounded sentences before display.
  Supported regions include East US (where resources live).
  Docs: [Groundedness detection](https://learn.microsoft.com/azure/ai-services/content-safety/concepts/groundedness)

## 2. AI safety & abuse resistance

- **[done]** Agent instructions treat user-submitted evidence as untrusted and
  refuse to follow instructions embedded in it (`docs/AGENT_INSTRUCTIONS.md`).
- **[next]** **Prompt Shields** (Content Safety) on every evidence input —
  evidence is exactly the "indirect / cross-domain prompt injection" vector
  (malicious instructions hidden inside a screenshot or email the agent
  processes). Enable the indirect-attack shield + default content filters on the
  Foundry model deployment.
  Docs: [Prompt Shields](https://learn.microsoft.com/azure/ai-services/content-safety/concepts/jailbreak-detection) ·
  [Default safety policies](https://learn.microsoft.com/azure/foundry/openai/concepts/default-safety-policies)
- **[next]** **Adversarial-use throttle.** A scammer could probe the tool to
  pre-test flyers until they pass. Mitigations: rate-limit by IP/account; for
  anonymous callers, return the risk band + guidance but **not** a
  signal-by-signal breakdown of exactly which rule fired.
- **[later]** **Task adherence** checks on agent tool use to catch misaligned or
  premature tool calls. Submission fingerprinting to detect probing patterns.

## 3. Evaluation (measure, don't vibe)

- **[done]** Offline eval harness over `tests/test_cases/*.json` asserting risk
  band, score range, required/forbidden signals, and network match; runs in CI
  (`tests/unit/evals.test.ts`). 13 cases include SA scam patterns, spoken
  report/training-fee narrative, and legitimate controls. Redaction has its own
  unit tests.
- **[done]** **False-positive / false-negative metrics**, not just pass/fail —
  the offline eval summary reports both counts and the Jest gate asserts they
  remain zero for the current labelled suite.
- **[next]** **Grow the labelled corpus** from real (privately held) cases into
  more synthetic fixtures across categories: aggregator ring, free-host harvest,
  upfront-fee, document-harvest, impersonation, legitimate, and ambiguous.
- **[later]** **Foundry evaluation SDK + tracing** to score live agent runs for
  groundedness/relevance and to inspect tool-call traces during judging and
  regression.

## 4. System design & operations

- **[done]** Graceful degradation: every subsystem (Foundry, Search, OCR, web
  research, **voice transcription**) is optional and reported by `GET /health`;
  the deterministic path is always available.
- **[done]** **Voice Investigation intake** (`backend/speech/speechToText.ts`,
  `POST /transcribe`): Azure AI Speech Fast Transcription, **key-gated** on
  `AZURE_SPEECH_REGION` + `AZURE_SPEECH_KEY` (candidate locales via
  `AZURE_SPEECH_LOCALES`, default `en-ZA,en-US,en-GB`) so the offline pipeline is
  unchanged. Hardened like every other intake: 6/min/IP rate limit, 25 MB cap,
  magic-byte audio sniffing (`sniffAudioType` — WAV/MP3/M4A/OGG/FLAC/WebM/AMR),
  `503` when unconfigured (reported as `capabilities.voice_transcription`),
  `422` when no speech is recognised. **No raw audio is retained** (POPIA s10):
  the buffer is processed in memory and discarded; only the redacted transcript
  persists, through the same boundary as typed text. Design:
  [`docs/VOICE_INVESTIGATION_DESIGN.md`](VOICE_INVESTIGATION_DESIGN.md).
- **[done]** **Voice eval determinism at the pipeline boundary** —
  `AZURE_SPEECH_*` is scrubbed in offline eval/stress runs, voice-style
  narrative cases flow through `/analyze`, and audio magic-byte sniffing has
  direct unit coverage for WebM/WAV/MP3/AMR plus disguised-payload rejection.
- **[next]** **Voice product expansion** — evaluate **Azure Neural TTS** for
  SA-accented report read-back (today it is on-device `speechSynthesis`) against
  the cross-border data-residency questions in `docs/PRIVACY.md` §8. Opt-in
  **audio retention** for re-analysis stays gated behind consent UX + a
  retention schedule.
- **[done]** PII redaction at the store/log boundary (`backend/privacy/redaction.ts`).
- **[done]** **Data minimization at external-API ingestion** (POPIA s10): the
  verification providers deliberately discard person-level fields the upstream
  APIs return — a phone number's registered-owner name, an email's sender name —
  so identities of third parties are never ingested, stored, or logged; only
  line type / reputation / domain age reach the scorer.
- **[done]** **AuthN/AuthZ + access accounting**: Entra JWT validation is
  env-gated; signed-in usage is metered; anonymous trial checks are bounded by
  `AUTH_ANON_TRIAL_MAX`; account/case/evidence routes are caller-scoped; admin
  moderation requires an `admin` role or explicit break-glass allow-list.
- **[next]** **Adversarial-use response shaping**: rate limits and tool-call
  caps already exist, but anonymous over-limit UX and signal-detail suppression
  should be verified live before public traffic.
- **[next]** **Observability.** App Insights + Log Analytics are already
  provisioned — wire structured, **redacted** request/decision logging and
  dashboards (latency, engine mode, signal distribution, FP rate). Pre-warm the
  first Foundry call (cold start is slow).
- **[next]** **Data residency & secrets** — deploy to Azure South Africa North
  for an SA service; secrets to Key Vault. (See `docs/PRIVACY.md` §8, §4.)
- **[later]** **Cost controls** — publish per-case cost (tool calls + tokens);
  cache domain/company/URL lookups; scale-to-zero for idle (already advised in
  the deploy skill).

## 5. Detection coverage (product)

- **[done]** 21 base signals + 3 corpus-derived: `unofficial_application_channel`
  (brand vs aggregator/free-host/shortener apply channel — catches the
  template ring), `whatsapp_only_application`, and SA-locale fee/credential
  detection (rand "induction fee", ID/SARS/banking-proof asks).
- **[done]** **Real external verification layer** (`backend/verification/providers.ts`,
  key-gated so the offline pipeline is unchanged): real domain WHOIS/registration
  age via who-dat (free) + whoisjson fallback; **Abstract Email Reputation**
  (disposable/free-mail, MX, DMARC/SPF, **risky TLD**, domain age, address/domain
  risk, breach count); **Abstract Phone Intelligence** as a first-class tool
  (`lookup_phone_intel` — VOIP/line-type, disposable, abuse, risk) targeting the
  WhatsApp-number scams; **Abstract IP Intelligence** on the email Received: IP
  (proxy/Tor/hosting/abuse); Abstract Company Enrichment of the apply domain.
  New data-driven signals: `risky_tld_domain`, `email_flagged_high_risk`,
  `proxy_hosting_sender_ip`, `voip_recruiter_number`, `high_risk_phone`. These
  turn the previously-heuristic domain checks into real findings and make the
  long-dead `recently_registered_domain`/`established_domain` signals fire from
  true registration dates.
- **[next]** **Look-alike/brand-vs-official-domain** allow-list for the largest
  SA employers (Transnet, Eskom, SARS, Home Affairs, big retailers) so
  impersonation of a *specific* known brand scores higher than the generic
  channel signal.
- **[next]** **Shortener/redirect unwrapping** before domain checks, so the true
  destination of a `bit.ly`/`tinyurl` apply link is what gets analysed.
- **[later]** **Template fingerprinting** (shared broken merge-fields, repeated
  typos, identical layouts) as graph edges to cluster "different" flyers into
  one operator — a strong evidence-graph story.
- **[later]** **Stale-repost / internal-inconsistency** checks (closing date in
  the past; contradictory salaries).

## 6. Distribution (reach the victim where they are)

- **[later]** Job seekers see these scams **inside WhatsApp and Facebook
  groups**, not on a dashboard. A **WhatsApp bot** ("forward a job ad, get a risk
  report") is the real delivery vehicle; the web app is the right artifact for
  judging and for brand-protection/job-board customers.
- **[later]** **Feedback loop** — after a verdict, ask "did you proceed? did you
  lose money?" to grow the labelled corpus and measure real-world impact.
- **[later]** **Reporting pipeline** to SAPS / SAFPS for confirmed scams (civic
  impact + a stronger s11(1)(f)/s33 footing for the intelligence network).

---

## First production sprint (the [next] set, in order)

1. Live Entra provisioning + admin role assignment + `VITE_AUTH_*` build config.
2. Prompt Shields + default content filters on the Foundry deployment.
3. AI Search / Foundry IQ grounding for the report & chat agents (citations).
4. Strict output-schema validation with deterministic fallback.
5. Redacted structured logging + dashboards on the existing App Insights.
6. Expand the synthetic corpus and keep the FP/FN eval metrics at zero.
7. Privacy must-dos from `docs/PRIVACY.md` §9 (Information Officer, notice/consent,
   objection channel, retention job, SA-region/Key-Vault).

See also: [`docs/PRIVACY.md`](PRIVACY.md) · [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`docs/AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)
