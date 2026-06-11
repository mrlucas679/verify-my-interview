---
name: deep-research
description: Budgeted, evidence-disciplined research protocol — the loop principle adapted from karpathy/autoresearch (fixed iteration budget, one metric, keep-or-discard) refitted for investigation/competitive/docs research on this project. Use when a task needs external knowledge gathering — scam-pattern intelligence, Azure service capabilities, hackathon judging criteria, library evaluation — especially before building on top of an assumption.
---

# Deep Research (autoresearch-adapted)

Source principle ([karpathy/autoresearch](https://github.com/karpathy/autoresearch)):
an agent improves fastest inside a **constrained loop** — fixed budget per
iteration, ONE clear metric, explicit keep-or-discard after each run, human
sets direction in a charter file the agent re-reads every loop. There it
optimizes `train.py` against val_bpb in 5-minute runs; here we optimize a
**research question against an evidence bar** in bounded search iterations.

## The loop

0. **Charter (human direction).** Write the question + decision it informs +
   evidence bar into the run's research note FIRST:
   `.claude/orchestrator/research/<topic>.md`. One question per note — like
   `program.md`, it is re-read at every iteration; scope creep dies here.
1. **Iterate (max 3 rounds, ~5 tool calls each).** Pick the strongest source
   tier available, broad→specific:
   - Microsoft Learn MCP for anything Azure (authoritative, current);
   - WebSearch/WebFetch for the open web; Bright Data tools when a site
     resists fetching; Consensus/bioRxiv only for academic claims;
   - the repo + `hirng` corpus memory for scam-pattern questions (do NOT
     re-fetch what memory already holds).
2. **Evaluate against the bar.** A claim is *established* when 2+ independent
   sources agree (or 1 authoritative primary source: official docs, the law
   itself, the API's own reference) AND it is dated/current enough to act on.
3. **Keep or discard.** After each round, write back: claims established
   (with citation links + access date), claims still open, contradictions
   found. Discard rounds that added no signal — don't pad the note.
4. **Stop.** When the bar is met for the decision at hand, or the budget is
   spent — then report HONESTLY: answered / partially answered (what's
   missing) / not answerable now (what would unblock it).

## Hard rules

- **Never research what's already in memory/CLAUDE.md/docs/** — check first.
- **Citations or it didn't happen:** every load-bearing claim in the final
  answer links its source; mark single-source claims as such.
- **Date-stamp everything** (APIs/pricing/limits drift; deadline 2026-06-14).
- **No PII into search engines** (POPIA): investigate domains/patterns/IOCs,
  never a real person's name/ID from case evidence.
- **Contradictions are findings,** not noise — surface them with both sources
  rather than silently picking one.
- **Output is a decision input,** not a survey: end the note with "what this
  means for <the decision>" in ≤ 5 lines.

## When spawned as a research sub-agent

Brief = the charter note. Deliverable = the completed note + a ≤ 10-line
summary back to the orchestrator. Owned files: only your research note.
Forbidden: editing code/docs outside it, secrets in queries, exceeding budget.
