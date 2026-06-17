# Research: permanent (non-band-aid) implementation of the planned changes

Created 2026-06-16. Charter re-read every iteration. One question per section.

## Decision this informs
HOW to implement the planned VerifyMyInterview work as ROOT-CAUSE permanent
solutions (user directive: "stop creating temporary fixes"). Replaces the
band-aids shipped this session: `ensureCoreCoverage()` top-up, the 0.7 confidence
cap, `cleanModelText()` symptom-strip.

## Questions + evidence bar
Bar = 1 authoritative Microsoft primary source (official Foundry/Azure docs/API
reference), dated current (cutoff drift matters), per load-bearing claim.

- Q1 **Foundry tool-calling reliability**: does Foundry Agent Service / `@azure/ai-agents`
  support FORCING required tool calls (tool_choice = required/named) and/or
  STRUCTURED OUTPUTS (JSON-schema response_format)? If yes → the permanent fix is
  to enforce the verification tool calls + schema-constrain the agent reply,
  removing both `ensureCoreCoverage` and `cleanModelText`. If no → the permanent
  fix is the inverse: deterministic gathering stays the evidence AUTHORITY and
  Foundry only reasons over already-gathered results (no tool-calling in the
  investigator at all).
- Q2 **Principled confidence**: is there Microsoft guidance (agent evaluation,
  groundedness, confidence) to model confidence properly vs a hard cap? (Mostly
  internal design — light external research.)
- Q3 **Foundry IQ grounding**: exact connect pattern (knowledge base on AI Search,
  MCP `knowledge_base_retrieve`, identity/roles, API version) to permanently
  replace `matchGuidance`/`guidance.json` keyword matcher in the Reporter.
- Q4 **Runtime**: Microsoft's own guidance — App Service vs Container Apps vs
  Functions for a long-running Node/Express API that hosts Foundry agent calls.

## Round log

### Round 1 — 2026-06-16 (Microsoft Learn MCP, authoritative primary sources)

**Q1 tool-calling reliability — ESTABLISHED**
- `tool_choice` supports `auto` / `required` / `none`; `required` = "model MUST call one
  or more tools"; a named-tool object forces ONE specific function. Source:
  Tool best practices for Foundry Agent Service (learn.microsoft.com/azure/foundry/agents/concepts/tool-best-practice, accessed 2026-06-16).
- JS SDK `@azure/ai-agents` exposes `AgentsNamedToolChoice` ("force the model to call a
  specific tool"). (learn.microsoft.com/javascript/api/@azure/ai-agents/agentsnamedtoolchoice)
- KEY LIMIT: `required`/named force ≥1 / a single tool — there is NO native "call
  exactly these 4 tools" guarantee. So for a COMPLETENESS-critical gather step,
  LLM-driven tool selection can never be a hard guarantee → don't rely on it for gathering.

**Q1 structured outputs — ESTABLISHED**
- `response_format: { type: "json_schema", json_schema: {…}, strict: true }` → "the model
  will always follow the exact schema." Agent Framework: set `ResponseFormat` on
  AgentRunOptions / at agent init. Sources: Foundry Models REST v1 preview reference +
  agent-framework/agents/structured-outputs (accessed 2026-06-16).
- ⇒ `cleanModelText()` band-aid is replaceable by strict json_schema (garbage tokens
  become structurally impossible).

**Q3 Foundry IQ — ESTABLISHED (prior search, same session)**
- Managed knowledge base on Azure AI Search agentic retrieval; agents call it over MCP
  (`knowledge_base_retrieve`); needs project managed identity w/ `Search Index Data Reader`,
  KB API `2026-05-01-preview`. Sources: what-is-foundry-iq, foundry-iq-connect, foundry-iq-faq.

**Q4 runtime — ESTABLISHED**
- App Service = "optimized for web applications… ideal option" for web APIs. Container Apps
  = containerized microservices/event-driven + scale-to-zero. Functions = event-driven/
  per-execution. Functions can run natively ON Container Apps (`kind=functionapp`), so the
  Express API + future event-consumer Functions can share ONE Container Apps environment.
  Sources: container-apps/compare-options, container-apps/mcp-choosing-azure-service,
  container-apps/functions-overview (accessed 2026-06-16).

### Round 2 — 2026-06-16 — CONTRADICTION found (SDK reference)
- Earlier I concluded "strict json_schema structured outputs." That is an Azure OpenAI
  CHAT/RESPONSES feature, NOT an Agents-Service feature. `@azure/ai-agents`
  `AgentsResponseFormat.type` = `"text" | "json_object"` only
  (learn.microsoft.com/javascript/api/@azure/ai-agents/responseformat). The structured-
  outputs how-to explicitly lists "Azure AI Agents Service" as NOT supporting strict
  json_schema (learn.microsoft.com/azure/developer/ai/how-to/extract-entities-using-structured-outputs).
- Revised permanent design: reasoning runs use `responseFormat: { type: 'json_object' }`
  (guarantees a valid JSON OBJECT — no garbage/free-text). Field-level validation
  (`extractJsonObject` + `asStringArray` + bounded length cap per CLAUDE.md rule 3/5)
  stays as legitimate boundary validation, NOT a symptom patch. `cleanModelText`
  control-char strip is removed (JSON mode makes it moot).
- If TRUE strict-schema is ever needed, it requires the Azure OpenAI Responses API path,
  not the Agents thread/run path — out of scope for this change.

### Round 3 — 2026-06-16 — Foundry IQ PROVISIONED + VERIFIED (live, from terminal)
Created on search service `vmi-search-3907` (eastus), api-version `2026-05-01-preview`,
key auth (admin key via `az search admin-key show`). All free metadata objects, reversible
(DELETE). Index `scam-reports-v2` is seeded (35 docs); `scam-reports` v1 has 26.
- **Knowledge source** `scam-reports-ks` (kind=searchIndex → scam-reports-v2,
  sourceDataFields: reportId,companyName,scamType,description,location,reportedAt).
- **Knowledge base** `vmi-scam-kb` — `outputMode: extractiveData` (NOTE: enum is
  `extractiveData`, NOT `extractedData` which the docs mistype), `retrievalReasoningEffort:
  { kind: minimal }`, NO `models` → **no LLM, zero per-query cost**. Our Reporter synthesizes.
- **Working retrieve contract** (minimal effort): `POST {searchEndpoint}/knowledgebases/
  vmi-scam-kb/retrieve?api-version=2026-05-01-preview`, header `api-key`, body
  `{ "intents": [ { "type": "semantic", "search": "<query>" } ] }`. Minimal effort REJECTS
  `messages` input (use `intents`); each intent = `{type:'semantic', search:'...'}`.
  VERIFIED: returns `response[].content[].text` = JSON array of `{ref_id, content}` grounding
  passages (confirmed real matches: Meta/Stripe/Deloitte/Microsoft impersonation + WhatsApp + fee).
- **Caveat:** index has a vector field but NO vectorizer, so agentic retrieval ignores vectors
  and uses text/semantic search over searchable fields (works fine; add a vectorizer later for
  better recall). Semantic reranking worked without an explicit semantic config.
- **Remaining (DEFERRED per user — "don't worry about the Foundry code for now"):**
  (a) CODE: wire the app to call this retrieve to ground the Reporter — NOTE it overlaps the
  existing `scamNetwork.search` (vector kNN over the same index), so decide augment-vs-replace;
  fits the OSINT "capability in existing tools" directive (add as a key-gated provider w/ graceful
  degradation; env e.g. AZURE_SEARCH_KNOWLEDGE_BASE=vmi-scam-kb). (b) Optional Foundry project
  `RemoteTool`/MCP connection if we want the Foundry AGENT to call the KB autonomously (not needed
  for direct-REST consumption — the FAQ confirms any app can call the KB APIs).

## What this means for the decision
1. Investigator permanent design = **deterministic gathering stays the evidence AUTHORITY**
   (it already calls every relevant tool — correct for a fraud tool; `required` can't
   guarantee completeness). Foundry reasons OVER the gathered results with **strict
   json_schema** structured output. This deletes BOTH band-aids (`ensureCoreCoverage` +
   `cleanModelText`) at the root, not by patching symptoms.
2. Foundry tool-CALLING belongs in CHAT (user-driven, on-demand, completeness not required) —
   already correct there; add `tool_choice` only where a specific tool must fire.
3. Confidence = principled weighted model (agreement − struck-claim ratio − conflict +
   coverage), not a 0.7 cap. Internal design; no external bar.
4. Foundry IQ = permanent replacement for `matchGuidance`/guidance.json in the Reporter.
5. Runtime = Express on Container Apps (Dockerfile already fits); App Service is the
   App-Service-plan equivalent. Retire the duplicate HTTP Functions; reserve Functions for
   future Service Bus/Event Grid consumers, co-hosted in the Container Apps environment.
