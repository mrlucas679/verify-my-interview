---
name: lean-delegation
description: >-
  Standing operating discipline for THIS repo: offload simple/bounded coding work
  to a cheaper Haiku/Sonnet sub-agent (keeping Opus for real judgement), keep the
  main context window from filling up, and always reuse the repo's existing skills.
  Apply on EVERY task — especially long multi-step sessions, bulk edits, repo-wide
  searches, gate runs, and doc/boilerplate work.
---

# Lean Delegation

Goal: finish the work for the least context + cost, without dropping quality.
Three habits, applied every task.

## 1. Tier the model — delegate the simple, keep the hard

Use the **Agent tool** with a `model` override. Spawn a delegate when a task is
**bounded, mechanical, and low-judgement**; stay on the main model when it needs
real reasoning.

**Delegate to `haiku`** (trivial, well-specified):
- Find-and-replace / rename across files; apply a clearly-described edit to N files.
- "Where is X?" repo searches; locate a symbol/route/usage and report the path.
- Read one file and summarise the relevant part.
- Generate boilerplate: env-var docs, a test skeleton, a type stub, a comment block.
- Run the gates (`npm run build/lint/eval/test`, `tsc --noEmit`) and report pass/fail + the failing lines only.

**Delegate to `sonnet`** (moderate, still well-scoped):
- Implement a small self-contained module/function from a precise spec.
- Write a focused test from described cases.
- A bounded refactor confined to a file or two with a clear goal.
- A medium repo investigation that returns a conclusion, not a file dump (use the **Explore** agent).

**Keep on the main model — do NOT delegate:**
- Architecture / data-model / API-shape decisions; anything touching the deterministic
  scorer, signal engine, POPIA/redaction, or security posture.
- Ambiguous requirements, trade-offs, "which approach" calls, root-cause debugging.
- Final review of any risky/irreversible change before it ships.

**When you delegate:** give the sub-agent a self-contained brief (it has no memory of
this chat) — the exact task, the files, the relevant CLAUDE.md rules + house skill (below),
and the gates to run. Require a **concise** result (diff summary / answer / pass-fail), not
a transcript. Don't spawn for something faster done inline (a cold sub-agent re-derives
context — that's the expensive path); delegate to SAVE main-context or cost, not reflexively.

## 2. Keep the context window lean

- Push expensive reading/searching into a sub-agent: **it reads a lot, returns a little.**
- Don't re-read files already read this session; trust prior context. Use targeted
  **Grep/Glob** over reading whole trees in the main window.
- Write durable findings to **memory** (`MEMORY.md` + a memory file) or a repo doc —
  not back into the chat. Recall later instead of re-deriving.
- `mark_chapter` at phase boundaries; summarise long stretches instead of carrying detail.
- When a thread grows large, hand the next bounded chunk to a fresh delegate rather than
  dragging the whole history forward.
- Verify with gates/logs (text), not by re-dumping files or large outputs.

## 3. Always reuse this repo's skills

Before starting, check whether a house skill already covers the work and USE it (and pass
its rules into any delegate's brief):
- **sentinel-ui** + **impeccable-design** — any change in `frontend/`.
- **foundry-agents** — agents, tools, orchestrator (`src/backend/agent/`).
- **evidence-graph** — `src/backend/network/`, `/network/*`, graph UI.
- **deep-research** — external knowledge gathering (Azure/Foundry docs, scam intel) before building on an assumption.
- **deploy-azure-foundry** — deploy/provision to Azure.
- **threejs** — 3D visuals.
- **multi-agent-opus-orchestrator** — large, multi-domain builds/audits that span several areas.

If a needed capability has no skill yet, consider adding one so the next session inherits it.

## Quick rule of thumb
> Mechanical + bounded → Haiku.  Small + scoped → Sonnet.  Judgement, scoring, security,
> ambiguity, final review → stay on Opus.  Heavy reading/searching → push to a delegate so
> the main window stays clean.  Frontend/agents/graph/deploy → load the matching house skill first.
