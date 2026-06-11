# PROJECT_STATE — orchestrator source of truth

Updated: 2026-06-11 (orchestrated sprint COMPLETE: voice feature + docs + skills + review)

## Objective
Ship the Voice Investigation MVP ("Tell Us What Happened") + capture its design,
with all verification gates green, before the 2026-06-14 submission. DONE.

## Decisions
- D1: Voice = third evidence channel feeding the SAME pipeline: `/transcribe`
  (Azure Speech Fast Transcription, key-gated) → editable transcript → `/analyze`.
  The deterministic scorer remains the only source of risk scores.
- D2: **Raw audio is NOT retained in the MVP** (transcript only). POPIA
  minimality; opt-in consented retention is roadmap.
- D3: Report read-back uses browser speechSynthesis (free, offline, no PII
  leaves the device); Azure Neural TTS is the production roadmap item.
- D4: Sub-agents get disjoint write-sets; only the orchestrator commits.
- D5 (from review): `redactSensitiveIdentifiers` now runs at the **/analyze
  boundary** (server.ts) so ALL evidence channels (typed/OCR/voice) are
  redacted before any pipeline processing — code now matches the documented
  POPIA invariant. Evals stayed 11/11 (IOCs preserved by design).
- D6: External skill packs adopted as HOUSE-ADAPTED skills (never verbatim):
  impeccable-design (pbakaus/impeccable), deep-research (karpathy/autoresearch
  loop principle), threejs (grounded via Learn-Three.js MCP, r181). CLAUDE.md
  now carries NASA Power-of-10 TS rules + the proactive tooling mandate.
- D7 (from review): provider request hardening — /transcribe sends a
  server-derived MIME + filename from the sniffed kind; client strings never
  reach the Azure multipart request. Limiter evicts oldest 10% instead of
  clearing (no fail-open under spoofing floods). Non-size multer errors → 400.

## Requirements coverage
| Req | Owner | Status | Evidence |
|---|---|---|---|
| /transcribe backend (Azure Speech, sniffed, rate-limited) | orchestrator | DONE | server.ts, speech/speechToText.ts, guard sniffAudioType |
| Voice recorder UI + NewCase tab | Agent A (af3816b…) | DONE | VoiceRecorder.tsx, NewCase.tsx voice tab |
| Report audio read-back | Agent A | DONE | Report.tsx ListenButton (speechSynthesis) |
| Voice design doc (POPIA-aligned) | Agent B (a5058c6…) | DONE | docs/VOICE_INVESTIGATION_DESIGN.md |
| Readiness doc voice rows | Agent B | DONE | docs/PRODUCTION_READINESS.md §4 |
| Independent review + remediation | reviewer (a5bea20…) + orchestrator | DONE | 9 findings: 1 MAJOR + 2 MINOR fixed, 4 NIT fixed/closed, 2 accepted |
| Gates green | orchestrator | DONE | build ✓, lint 0/0, jest 21/21, eval 11/11, secret-scan clean |
| Orchestrator skill + skill packs + CLAUDE.md | orchestrator | DONE | .claude/skills/{multi-agent-opus-orchestrator,impeccable-design,threejs,deep-research}, CLAUDE.md |

## Assumptions / accepted residual risks
- A2 (PARTIALLY CLOSED 2026-06-11): Azure Fast Transcription verified LIVE —
  WAV in, correct transcript out, en-ZA locale auto-selected, response shape
  (combinedPhrases/durationMilliseconds/phrases[].locale) matches the code,
  AIServices multi-service key works (region eastus2). Localized "R950"
  correctly. Still to confirm in a browser: MediaRecorder webm/opus input.
- AR1 (accepted): `ftyp` sniff overlap (m4a vs heic across the two sniffers)
  is benign — wrong route just yields a clean provider error.
- AR2 (accepted): dependency major-bumps (tsx 4, typescript-eslint 7) rode
  along with the feature; all gates pass against them.

## Risks
- R1: Deadline 2026-06-14 — voice is additive; demo path (text/upload) unchanged.
- R2: Browser mic permissions during demo recording — rehearse before filming.

## Open questions
- Q1: Live Azure rehearsal timing (needs AZURE_SPEECH_REGION/KEY in .env;
  also verifies A2 and the Foundry/Search/DocIntel paths end-to-end).

## Agent log
- 2026-06-11 orchestrator: backend voice endpoint + guards + env + orchestrator skill + CLAUDE.md.
- 2026-06-11 Agent A (opus, af3816b2791f8a3c7): voice UI complete; build/lint/typecheck green; steady-dot recording indicator per impeccable-design.
- 2026-06-11 Agent B (opus, a5058c61a1f8f756e): design doc + readiness rows; found the 413-copy mismatch.
- 2026-06-11 reviewer (opus, a5bea20d4cd777550): FIX-THEN-SHIP, 9 findings.
- 2026-06-11 orchestrator: all findings remediated (redaction boundary, 413/400,
  limiter eviction, sniffed-MIME provider call, recorder failsafe, SCRUBBED_ENV
  + AZURE_SPEECH_*, doc corrections, zero lint warnings); gates re-run green.
