# Multi-Pass Investigative Architecture

Date: 2026-06-12

## Question

Should VerifyMyInterview evolve into a multi-pass investigative architecture, and if so what is the simplest accurate, scalable, maintainable, secure, explainable, and trustworthy design that improves scam detection without disrupting the existing app?

## Decision This Informs

Future architecture roadmap for investigation orchestration, agent isolation, evidence handling, retrieval, evaluation, observability, MCP/tool access, human review, and continuous learning.

## Evidence Bar

- Current repo behavior must be inspected before recommending changes.
- Load-bearing facts need primary documentation, research papers, or at least two trustworthy independent sources.
- Clearly separate verified facts, informed inference, hypothesis, and speculation.
- Prefer simpler architectures when they achieve equal or better accuracy, safety, and maintainability.
- No code changes; architecture/research only.

## Hypotheses To Test

1. A five-stage multi-pass workflow improves reliability over the current six-stage linear pipeline.
2. Evidence isolation and blind verification reduce confirmation bias in agent investigations.
3. Skeptic/red-team stages improve accuracy enough to justify cost and latency.
4. Controlled evidence sharing is better than fully isolated independent investigations.
5. A Judge/Adjudicator should assign final outcome categories, while deterministic scoring still computes numeric risk.
6. MCP/tool gateway and centralized evidence store should become product-runtime architecture later.

## Round 0: Repo Grounding

Observed current implementation:

- Current app already has a staged investigation pipeline: Evidence,
  Verification, Research, Network, Critic, Report.
- Deterministic scoring remains the safety spine: agent findings feed
  `deriveSignals()` and `scoreStructuredSignals()`, while LLM output does not
  invent a numeric risk score.
- `PipelineTrace` already captures stage order, engine, duration, findings,
  tool calls, investigator reasoning, critic output, and removed claims.
- `ToolOrchestrator` already behaves like an internal tool gateway with call
  budgeting and cache behavior. This reduces the immediate need for a runtime
  MCP server.
- Current docs already identify the right next controls: strict schema
  validation, Prompt Shields, Foundry evaluation/tracing, observability,
  adversarial-use throttling, graph over-linking tests, and human review.
- The active confidence formula is still too coverage-driven. It should account
  for disagreement, evidence quality, contradictions, false-positive risk, and
  whether claims survived critique.

Verdict: the codebase is not missing "multi-agent architecture" in the broad
sense. It is missing a stronger evidence ledger, cleaner extraction, better
research precision, confidence calibration, and conditional independent review.
Those should come before a major orchestration rewrite.

## Round 1: Evidence From Docs And Research

Verified facts:

- FTC and FBI guidance show employment scams have evolved from classic fake
  checks and placement-fee scams into remote-work, crypto, and gamified "task"
  scams. FTC reported job-scam losses more than tripled from 2020 to 2023 and
  exceeded $220M in the first half of 2024; task scams rose sharply in reports.
  Sources: FTC job scams, FTC Data Spotlight 2024, FBI IC3 PSA 2024.
- FBI guidance specifically describes crypto job scams where fake recruiters
  impersonate legitimate companies, provide online-only training, allow early
  withdrawals, then require larger deposits to unlock tasks or earnings.
- BBB warns modern job scammers may use real employer names, interviews, and
  phony offer letters. This supports verifying mechanics and infrastructure,
  not merely "professional-looking" wording.
- INTERPOL and FATF describe cyber-enabled fraud as industrialized and
  transnational, with scam centers, money laundering networks, crypto-based
  scams, fake job offers, and AI/low-cost tooling as scaling factors.
- Multi-agent debate research supports the possibility that independent model
  instances can improve factuality/reasoning on studied tasks, but it is not
  direct evidence that a five-stage fraud workflow improves VerifyMyInterview.
- Social-influence research shows even mild sharing of others' judgments can
  reduce diversity and undermine crowd accuracy in estimation tasks. This
  supports blind review and conclusion isolation, but it does not prove agents
  must never collaborate.
- Microsoft Agent Framework explicitly recommends agents for open-ended tasks
  and workflows for well-defined steps; it also says if a function can handle
  the task, prefer a function over an AI agent.
- Foundry Agent Service supports tools, MCP servers, custom functions,
  tracing, observability, identity/security, Prompt agents, and Hosted agents
  (preview). This makes Foundry suitable for productionizing the current design
  without replacing it.
- Foundry tracing captures inputs/outputs, tool usage/results, token
  consumption, and latency via OpenTelemetry-compatible traces. This is useful
  for auditability, but trace payloads may include sensitive data and must be
  redacted/minimized.
- Foundry Agent Evaluators include process checks such as tool call accuracy,
  tool selection, tool input accuracy, tool output utilization, and tool call
  success, plus quality/system evaluators. Some evaluators have tool support
  limitations, so VerifyMyInterview should keep local deterministic eval gates.
- MCP is a standard interface for connecting AI applications to external
  systems, tools, data sources, and workflows. It helps standardize tool access
  but does not automatically make tools safe or trustworthy.
- NSA MCP guidance warns that production/high-stakes MCP deployments need
  implementation rigor, constraints, validation, and security controls; broad
  tool execution can create high-severity arbitrary-code-execution risk.
- OWASP LLM guidance treats prompt injection, indirect prompt injection,
  sensitive-information leakage, data/model poisoning, excessive agency, and
  vector/embedding weaknesses as major LLM application risks.

## Round 2: Architecture Options And Trade-Offs

Options considered:

1. Full five-stage multi-pass workflow on every investigation.
   - Benefit: clean mental model; strong challenge loop.
   - Cost: higher latency/cost, more prompts, more hallucination surface, more
     telemetry/privacy risk, and more complicated evals.
   - Verdict: overbuilt as the default path.

2. Keep current pipeline unchanged.
   - Benefit: lowest risk before hackathon; already deterministic and tested.
   - Cost: leaves known gaps: extraction bugs, research precision, confidence
     calibration, and evidence-ledger quality.
   - Verdict: good for immediate stability, insufficient for long-term trust.

3. Risk-adaptive multi-pass workflow.
   - Benefit: current fast path remains; independent review appears only when
     evidence is contradictory, high-impact, sparse, user-reported, or near a
     risk threshold.
   - Cost: requires better routing and trace/eval design.
   - Verdict: strongest fit for accuracy, maintainability, cost, and the
     hackathon narrative: "fast when evidence is obvious, deeper when a human
     could be harmed by a missed scam or a false accusation."

4. Replace orchestration with LangGraph/CrewAI/AutoGen/Agent Framework now.
   - Benefit: durable graphs, human-in-loop, visual traces, built-in patterns.
   - Cost: migration risk, language/runtime mismatch, new framework debt.
   - Verdict: not now. Consider Microsoft Agent Framework or Durable Task when
     durable production workflows and human-review queues become real scale
     needs. Avoid new AutoGen adoption because the Microsoft repo says it is in
     maintenance mode and recommends Microsoft Agent Framework for new users.

5. Product-runtime MCP server now.
   - Benefit: standardized tool access for many future agents.
   - Cost: security boundary, auth, least privilege, schema validation, audit,
     rate limits, and PII controls must be designed carefully.
   - Verdict: later. The current ToolOrchestrator already centralizes tools
     inside the app. MCP becomes compelling when external clients, multiple
     runtimes, or separate agent services must share the same governed tools.

## Recommendation

Adopt a risk-adaptive investigative architecture:

1. Immediate: build an Evidence Package / Claim Ledger around existing outputs.
   This is the lowest-risk foundation. Every claim should point to evidence
   IDs, source tool, entity, timestamp, trust level, redaction status, and
   whether the critic accepted, weakened, or rejected it.

2. Immediate: fix extraction and research precision before adding more agents.
   Known examples: header IPs parsed as phones, company names missed from
   subject/spoken narrative, official-listing and complaint evidence matched too
   broadly, and plain-language labels still too technical.

3. Near-term: make confidence measure agreement, not tool coverage. Confidence
   should fall when evidence conflicts, when the critic strikes claims, when
   only weak semantic similarity exists, when research citations are off-domain,
   or when positive/negative signals are both present.

4. Near-term: add a conditional Blind Reviewer / Skeptic pass. It should see
   evidence and signals, not prior verdict prose. It should output missing
   evidence, contradictions, alternate legitimate explanations, hallucination
   risks, and "requires human review" reasons. It must not set the score.

5. Later: add Adjudication as category assignment, not numeric scoring.
   Deterministic scoring remains the numeric source of truth; adjudication maps
   score + evidence quality + uncertainty into categories such as Verified
   Legitimate, Likely Legitimate, Insufficient Evidence, Requires Human Review,
   Suspicious, and High Risk Scam Indicators.

6. Later: add MCP only as a governed tool boundary. Prefer Azure Functions MCP
   or a locked-down internal service with Entra/OAuth, strict schemas, rate
   limits, tool allowlists, redaction, audit logging, and no broad shell/file/db
   tools. MCP is a tool gateway, not a scoring engine or evidence truth source.

7. Continuous learning: quarantine user reports until corroborated, promote
   graph trust only through hard identifiers and independent corroboration, and
   convert new scam patterns into eval fixtures before adding new red signals.

Bottom line: the best architecture is not "more agents." It is deterministic
scoring plus stronger evidence provenance, conditional independent challenge,
better calibrated uncertainty, and human review for high-impact ambiguity.

## Hackathon-Winning Interpretation

The goal is not to avoid multi-pass investigations. The goal is to make
multi-pass the system's visible trust advantage without wasting passes on cases
where hard evidence is already decisive.

Use an escalation ladder:

1. Fast path: deterministic extraction, tool verification, signal scoring, and
   plain-language report when evidence is strong and internally consistent.
2. Challenge path: blind reviewer + skeptic pass when evidence is incomplete,
   contradictory, close to a threshold, user-submitted as a report, or likely to
   harm a legitimate company if over-flagged.
3. Deep path: controlled evidence reconciliation + adjudication + human-review
   recommendation when money transfer, crypto, training fee, impersonation,
   official-company spoofing, or safety-critical uncertainty appears.

This is stronger than a single investigation because it prevents one agent's
missed extraction, bad search hit, hallucinated source, or overconfident
semantic match from becoming the final user-facing truth. It is stronger than
running five passes every time because it preserves speed, cost control, and
demo clarity.

What this means for the decision: build toward multi-pass as the product's
trust architecture, but route cases by evidence quality and risk. The demo
should make the escalation visible: "one clean case resolves quickly; one
ambiguous scam report triggers deeper independent challenge before judgment."
