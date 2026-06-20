# Research note — Investigation Workspace UX decisions

**Created:** 2026-06-18 · Owner: design (Claude, delegated full control by user)
**Re-read every iteration. One charter, four linked decisions.**

## Questions + the decision each informs
1. **Intent model** — auto-detect vs explicit "Report" action vs always-verify.
   Decides how the single composer routes Verify (full result) vs Report (ack-only).
2. **Report reply** — pure ack / ack + optional self-check / ack + notify.
   Decides what a scam reporter sees. Constrained by victim well-being + trust/safety norms.
3. **Persistence** — ephemeral session now vs persistent threads now.
   Decides whether we build thread history before auth is live.
4. **Result presentation** — confirm "intelligence cards, not chat bubbles" against
   real AI-first product patterns (sanity check, low priority).

## Evidence bar
A recommendation is *established* when 2+ independent sources agree, or 1 authoritative
primary (official fraud-reporting body, established design-research org, the product itself).
Date-stamp all. UX patterns drift; weigh post-2023 sources higher.

## Constraints (from the user, non-negotiable)
- Single AI-first workspace; Sentinel design (no emojis, dark ops console, not a chatbot).
- Security-first; POPIA; graceful degradation; fail-fast in prod.
- Make it ours (blend, don't clone). Backend already supports analyze/report/upload/
  transcribe/chat/share/cases/evidence + admin moderation.

## Round 1 — findings (2026-06-18)

**Q2 Report reply — ESTABLISHED (2 authoritative primaries + design principle).**
- FTC ReportFraud: on submit you get a **report number + "what to do next" tips** (+ email
  if provided); **no individual response/investigation feedback**; report flows into the
  shared Consumer Sentinel DB (2,000+ law-enforcement partners). [FTC]
- FBI IC3: **save your reference number** (only copy you get); **"You will not be contacted";**
  analysts review + may refer to agencies; file a *new* complaint to add info. [IC3]
- Trauma-informed design (SAMHSA-derived): give users **control + choice + anonymity**,
  clear next steps, reassurance — never a dead end. [UX Content Collective, GOV.UK MoJ]
→ Pattern is proven: **ack + reference id + concrete safety next-steps, no per-report verdict**,
  plus (trauma-informed refinement) an *optional* "also check this for me" so we never trap a
  distressed victim in a dead-end "thank you".

**Q1 Intent model — ESTABLISHED.** Pure auto-detect is brittle → "circular clarifications and
angry users"; misclassification cost must drive the design; best practice is **auto-detect +
explicit user control / confidence-based**, never silent routing. [secondary.ai, UX Tigers, Lyzr]
→ Misclassifying a frightened victim is high-cost. Default to the SAFE intent (**Verify always
helps**), make **Report an explicit one-tap action**, and **auto-SUGGEST** report (non-blocking
chip) when content signals "already happened". Never auto-route to the silent path.

**Q4 Cards vs bubbles — ESTABLISHED.** LLM outputs outgrew chat bubbles; modern pattern is
**cards/panels with source attribution + inline actions**; trade-off = "less conversational"
(fine for an investigation tool). [MultitaskAI, NN/g on Perplexity, OrangeLoops]
→ Confirms intelligence-card stack. Reuse VerdictCard/Findings/NetworkMatches/GuidanceCitations
as card types; each gets expand/collapse/copy/share/save.

**Q3 Persistence — ESTABLISHED (with nuance).** Anonymous/lazy registration lowers friction and
lets users taste value (opt-in trials ~18–25% convert); BUT users who invest effort want
reassurance their work is **saved** before committing (recruiter counter-example). [Custify, CXL,
Userpilot, NN/g lazy-registration]
→ **Ephemeral anonymous first; prompt sign-in at the moment of value** (save / share / history),
not up front. Build persistent threads against existing /cases when auth goes live.

## Decision (what this means — locked, design owner)
1. **One composer, default Verify.** Report is an explicit one-tap mode + a confidence-based
   auto-suggestion chip ("looks like this already happened — report it to protect others?").
2. **Report reply = ack + reference id + 2–3 safety next-steps + one optional "check it for me".**
   Investigation still runs silently server-side → pipeline → network → moderator queue.
3. **Intelligence-card stack** (expand/collapse/copy/share/save), Sentinel-styled, not bubbles.
4. **Ephemeral now; sign-in prompted at save/share/history; threads later via /cases.**
5. Anonymous users MAY report (anonymity matters per trauma-informed); reports enter as
   `unverified` trust → moderator queue, so the network can't be poisoned without review.
