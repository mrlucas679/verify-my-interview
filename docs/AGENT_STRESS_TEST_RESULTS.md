# Agent Stress Test Results

Generated: 2026-06-12

This stress pass focused on whether the agent pipeline is grounded in evidence
or merely producing plausible narrative. The tests go beyond final verdict
matching and assert workflow order, structured signal grounding, red-flag
citations, tool-call discipline, prompt-injection resistance, false-positive
controls, graph over-linking, and tool parameter quality.

## Current Commands

- Offline deterministic regression: `npm run stress:agents`
- Limited live/provider subset: `npm run stress:agents -- --live --limit=2`
- Targeted case replay: `npm run stress:agents -- --case=paid-training`
- Targeted live case replay: `npm run stress:agents -- --live --case=starter-kit`

Offline mode scrubs Foundry, Search, Speech, OCR, and OSINT environment
variables before importing the pipeline. Live mode loads `.env` and exercises
configured provider paths.

## Latest Results

| Command | Engine | Result | Notes |
|---|---:|---:|---|
| `npm run stress:agents` | deterministic | 13/13 pass | Full offline stress suite after red-team expansion |
| `npm run stress:agents -- --live --limit=2` | mixed | 2/2 pass | Limited live subset; Foundry attempted, deterministic fallback still used |
| `npm run stress:agents -- --live --case=paid-training` | mixed | 1/1 pass | Paid-training false-positive control |
| `npm run stress:agents -- --live --case=starter-kit` | mixed | 1/1 pass | Starter-kit upfront-payment false-negative control |
| `npm run stress:agents -- --live --case=otp` | mixed | 1/1 pass | Banking-app OTP credential-harvest control |
| `npm run stress:agents -- --live --case=personal-bank-account` | mixed | 1/1 pass | Money-mule refund-forwarding control; investigator fallback still observed |

Additional gates run after the stress harness edits:

- `npm run build:backend`: pass
- `npm run lint`: pass
- `npm run eval`: 12/12 pass
- `npm test`: 25/25 pass
- `npm --prefix frontend run typecheck`: pass
- `npm --prefix frontend run build`: pass, with the existing 537 kB chunk warning

## Stress Cases Covered

- Prompt injection cannot override obvious scam evidence.
- Benign interview document request is not treated as credential harvesting.
- `Received:` header IP addresses are not treated as recruiter phone numbers.
- Voice-style narrative training-fee phrasing is detected.
- Generic gift-card brand words do not create network graph links.
- Shortened application links are treated as unofficial channels.
- Sparse reply-bait SMS remains cautious instead of overconfident.
- Prompt injection cannot force a clean case to become high risk.
- Paid training/stipend language is not treated as an applicant-paid training
  fee.
- Starter-kit or uniform purchases required before a shift are caught as
  up-front payment.
- Banking-app OTP / approval-code requests are caught as credential harvesting.
- Personal-bank-account refund forwarding is caught as money-mule risk.
- Domain lookup receives the domain, full sender email, and sender IP when
  those fields are available.

## Issues Found And Fixed

The first offline stress run exposed two scorer gaps:

- A phrase like "expires in 2 hours" did not fire `urgency_pressure`.
- A standalone gift-card/payment demand scored only 35, keeping some clear fee
  scams below the `Suspicious` threshold.

Fixes applied:

- Added deadline-pressure detection for phrases such as "expires in 2 hours",
  "within 24 hours", "complete today", and similar short-deadline language.
- Increased `upfront_payment_request` from 35 to 40 points so payment-required
  job offers cross the suspicious threshold even when little else is present.

The red-team expansion then deliberately added four harder cases and exposed
four more weaknesses before fixes:

- "No application fee, training fee..." was counted as an up-front fee because
  negated fee language was not filtered.
- "You will be paid R 6 000 during training" was counted as if the applicant
  paid for training.
- "Buy the starter kit/uniform before induction" was missed because purchase
  verbs were not treated as fee demands.
- Banking-app OTP / approval-code language and personal-account refund
  forwarding were under-specified in the signal layer.

Additional fixes applied:

- Added negation filtering for fee cues, including SA fee cues.
- Added candidate-paid-benefit detection so paid stipends do not trigger
  `training_fee_narrative`.
- Added purchase-style starter-kit/uniform/equipment fee detection.
- Added OTP/app-approval credential cues.
- Added `money_mule_request` as a first-class red signal.
- Added `--case=...` targeted replay so live checks can focus on one stress
  case without running the full suite.

The first live subset also exposed a fixture problem:

- The benign control used a synthetic `kazirecruit.us` domain. Live tools
  correctly treated it as suspicious because it produced `no_mx_records`,
  `email_flagged_high_risk`, and `network_match`.
- The control fixture now uses an official `microsoft.com` sender with
  SPF/DMARC pass evidence, so the test measures credential-harvesting false
  positives rather than fake-domain reputation.

## Agent-Side Assessment

The product is not relying only on agent prose for the core verdict in the
offline path. The final score is derived from structured deterministic signals,
and the stress harness verifies that report red flags are backed by triggered
red signals. Tool calls and stage traces are also visible and bounded.

The live agent side is not fully proven yet. The limited live run passed, but
the engine mode was `mixed`, and logs still showed Foundry runs ending
`incomplete` for some stages before falling back to deterministic logic. That
is safer than hallucinating a verdict, but it means the project is not yet
getting full value from Foundry agents.

Current practical conclusion:

- Grounded deterministic investigation: strong enough for the current demo.
- Live Foundry agent behavior: integrated, but not complete enough to call
  production-ready.
- Agent narrative quality: needs sanitized trace capture and stage-specific
  evals before trusting live agent output at scale.

## Remaining Risks

- Foundry stage runs can end `incomplete`; fallback works, but this should be
  debugged before claiming reliable live-agent orchestration.
- Live stress coverage now includes the two-case smoke subset plus targeted
  red-team replays for paid-training, starter-kit, OTP, and money-mule cases.
  Running the full live stress suite would increase cost and external-provider
  noise, but it is still needed before production claims.
- Agent outputs are still parsed best-effort. Strict schema validation and
  typed fallback boundaries are needed.
- Per-agent inputs/outputs are not persisted as sanitized traces, so regression
  diagnosis is limited to console logs and final response shape.
- Live provider scoring can be sensitive to synthetic fixtures. Live evals need
  stable official domains and explicitly mocked external-provider controls.

## Recommended Next Steps

1. Fix Foundry `incomplete` runs.
   Capture run status details, required actions, tool-call handoff failures,
   timeouts, and model/deployment errors per stage. The goal is for live
   `investigator`, `verifier`, and `reporter` stages to complete without
   relying on fallback during smoke tests.

2. Add strict stage schemas.
   Validate each Foundry stage output with a schema before it can influence
   findings or narrative. Invalid output should produce a structured fallback
   reason in the trace.

3. Persist sanitized stress traces.
   Store case id, engine mode, stage status, tool names, provider status,
   signal ids, score, latency, and fallback reason. Do not store raw evidence
   or secrets.

4. Expand live stress gradually.
   `--case` now exists. Add `--tag` and provider-mock modes so groups of cases
   can be replayed cheaply. Then graduate the full suite into optional
   CI/nightly live checks.

5. Add per-agent evals.
   Score the investigator on tool selection and parameters, research on
   source classification, network on hard versus semantic matches, verifier on
   unsupported-claim removal, and reporter on evidence-backed user guidance.

6. Add production metrics.
   Track fallback rate, Foundry completion rate, false-positive rate on
   legitimate recruiter controls, false-negative rate on known scam controls,
   latency, and external-provider call count.
