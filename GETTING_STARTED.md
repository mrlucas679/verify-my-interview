# Getting Started

Full overview, architecture diagram and judging-aligned feature tour: [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Daily commands

```bash
npm install              # once (root); frontend deps install during build
npm run dev              # API with reload on :3000 (tsx watch)
npm run dev:web          # Vite frontend dev server (proxies the API)
npm run build            # backend tsc -> dist/ + frontend vite -> public/
npm start                # serve the built app on :3000
npm run eval             # run all eval scenarios offline, print pass/fail table
npm test                 # same evals as a Jest gate
npm run seed:network     # populate the Azure AI Search index (needs AZURE_SEARCH_*)
```

## Environment

`cp .env.example .env` and fill in what you have — every subsystem degrades
gracefully when its variables are blank:

- Nothing configured → deterministic engine, in-memory seeded network. The
  whole demo still works.
- `AZURE_AI_PROJECT_ENDPOINT` (+ `az login`) → Microsoft Foundry drives the
  six agents.
- `AZURE_SEARCH_*` → semantic matching over the indexed report corpus.
- `AZURE_DOCINT_*` → OCR for screenshot/PDF uploads.
- `SERPAPI_API_KEY` → live web/OSINT research with citations.

## Smoke checks

```bash
curl http://localhost:3000/health          # per-subsystem flags
npm run eval                               # 6/6 scenarios expected
```

Then paste the "Professional offer (ring case)" sample on the New Case page —
expect Likely Scam, a six-stage timeline, FTC/FBI/BBB citations, and an
evidence graph linking the case to the seeded Nimbus Talent ring.

## Working with Claude Code

Project skills in `.claude/skills/` encode the conventions: `sentinel-ui`
(design system), `foundry-agents` (agent/tool patterns + fallback contract),
`evidence-graph` (graph schema, trust rules, API), `demo-script` (video
storyboard), `deploy-azure-foundry` (Container Apps deployment).
