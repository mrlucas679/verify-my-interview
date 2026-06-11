# Production Readiness & Hardening Plan

What it takes to turn this hackathon build into a service real job seekers can
rely on. Grouped by theme, each item marked **[done]**, **[next]** (the first
production sprint), or **[later]**. The ordering inside each section is by
priority.

The guiding principle is already in the architecture and must not regress:
**agents gather and vet evidence; a deterministic scorer sets the risk; every
claim cites a source.** Hardening makes that pipeline grounded, safe, measured,
and operable — it does not move scoring into the model.

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
  (`tests/unit/evals.test.ts`). 11 cases incl. SA scam patterns + legitimate
  controls. Redaction has its own unit tests.
- **[next]** **Precision/recall metrics**, not just pass/fail — track
  false-positive rate on the legitimate-control set explicitly (a real recruiter
  flagged as a scam is the most costly error and a defamation risk).
- **[next]** **Grow the labelled corpus** from real (privately held) cases into
  more synthetic fixtures across categories: aggregator ring, free-host harvest,
  upfront-fee, document-harvest, impersonation, legitimate, and ambiguous.
- **[later]** **Foundry evaluation SDK + tracing** to score live agent runs for
  groundedness/relevance and to inspect tool-call traces during judging and
  regression.

## 4. System design & operations

- **[done]** Graceful degradation: every subsystem (Foundry, Search, OCR, web
  research) is optional and reported by `GET /health`; the deterministic path is
  always available.
- **[done]** PII redaction at the store/log boundary (`backend/privacy/redaction.ts`).
- **[done]** **Data minimization at external-API ingestion** (POPIA s10): the
  verification providers deliberately discard person-level fields the upstream
  APIs return — a phone number's registered-owner name, an email's sender name —
  so identities of third parties are never ingested, stored, or logged; only
  line type / reputation / domain age reach the scorer.
- **[next]** **AuthN/AuthZ + rate limiting** on all write/analyze endpoints;
  per-user quotas and tool budgets (tool-call caps already exist).
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

1. AuthN + rate limiting + adversarial throttle on `/analyze`, `/report`, `/chat`.
2. Prompt Shields + default content filters on the Foundry deployment.
3. AI Search / Foundry IQ grounding for the report & chat agents (citations).
4. Strict output-schema validation with deterministic fallback.
5. Redacted structured logging + dashboards on the existing App Insights.
6. FP-rate metric in evals; expand the synthetic corpus.
7. Privacy must-dos from `docs/PRIVACY.md` §9 (Information Officer, notice/consent,
   objection channel, retention job, SA-region/Key-Vault).

See also: [`docs/PRIVACY.md`](PRIVACY.md) · [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) ·
[`docs/AGENT_INSTRUCTIONS.md`](AGENT_INSTRUCTIONS.md)
