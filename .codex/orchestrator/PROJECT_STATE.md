# Verify My Interview Project State

Date: 2026-06-12

## Current Status

The app is in hackathon product-ready shape for the local/offline submission
path: deterministic pipeline, report dossier, voice/text/document intake,
entity graph, guidance citations, privacy boundary, and stress/eval gates are
implemented.

## Latest Product-Readiness Pass

- Fixed entity extraction regressions:
  - `Received:` header IPs are not recruiter phones.
  - Known impersonated employers such as Amazon are preserved ahead of staffing
    shells.
  - Voice-style phrases such as "company name is ..." and "company called ..."
    extract company names.
- Tightened web research precision:
  - official job listings require company-domain or recognised-job-board proof;
  - scam warnings must co-mention the researched company.
- Calibrated confidence:
  - critic disagreement, mixed evidence, semantic-only matches, and local-only
    pattern findings lower confidence.
- Added report-intake triage:
  - explicit scam reports are classified as `report`;
  - report summaries and next steps include evidence-preservation guidance.
- Removed the legacy zero-score deterministic scorer behavior.
- Added a synthetic spoken-report regression for "I wanted to report this" +
  named company + rand training fee; evals now cover that path permanently.
- Fixed Vite dev proxy drift so all API routes proxy to the backend.
- Added `npm run verify:product` as the one-command readiness gate.

## Verification Gate

Run:

```bash
npm run verify:product
```

This runs backend + frontend build, backend lint, frontend TypeScript checking,
Jest, offline evals, agent stress checks, and production audits for root +
frontend packages.

Latest known pass on 2026-06-12:

- Jest: 34/34
- Offline evals: 13/13
- Agent stress: 13/13
- Production audits: 0 vulnerabilities

## Do Not Auto-Start

Respect the user preference in `AGENTS.md`: do not start `npm start`,
`npm run dev`, `npm run dev:web`, browser servers, or Azure deployment without
explicit permission.

## Remaining Manual Submission Steps

- Run `npm run seed:network` once with Azure Search credentials active.
- Start the built app in a fresh terminal so `DefaultAzureCredential` can see
  `az login`.
- Browser-check MediaRecorder WebM/Opus through `/transcribe`.
- Record the <=5 minute demo video.
- Submit public repo link, video link, and architecture diagram before the
  hackathon deadline.

## Important Files

- Product readiness: `docs/PRODUCTION_READINESS.md`
- Architecture: `docs/ARCHITECTURE.md`
- Demo plan: `.agents/skills/demo-script/SKILL.md`
- Product gate: `package.json` script `verify:product`
- Research note: `.codex/orchestrator/research/multi-pass-investigative-architecture.md`
