# Live Launch Checklist

Status: draft for moving Verify My Interview from demo/product build to a real
live application. Created 2026-06-18 after the Investigation Workspace + History
redesign.

This list separates two launch moments:

- **Internal live preview:** deploy the current app to a real Azure URL so the
  owner can inspect it on phone/desktop and verify the real services.
- **Public beta:** allow real job seekers to use it safely, with auth, quotas,
  privacy controls, monitoring, and an operator path.

Do not call the app public-launch ready until every **Public beta blocker** is
closed or explicitly accepted in writing.

## Current Product Shape

### Implemented

- [x] Single AI-first Investigation Workspace at `/`.
- [x] One composer for pasted text, emails, links, PDFs, screenshots, text files,
  uploaded audio, and recorded voice.
- [x] Verify mode returns stacked investigation cards instead of a dashboard.
- [x] Report mode returns only an acknowledgment and reference id, not a verdict.
- [x] History screen at `/history` replaces the old community/network screen.
- [x] `/network` redirects to `/history` so old links do not expose graph UI.
- [x] Graph UI and `react-force-graph-2d` frontend dependency removed.
- [x] Similar prior reports render as plain cards when they are useful.
- [x] Shared report route `/s/:id` still opens in the workspace.
- [x] Backend endpoints exist for analyze, report, chat, upload, transcribe,
  share, accounts, cases, consented evidence storage, admin report deletion,
  health, and docs.
- [x] Deterministic scoring remains authoritative; agents do not invent scores.
- [x] POPIA redaction boundary exists for text, OCR, voice, and report intake.
- [x] Dockerfile builds backend + frontend and serves the SPA from Express.
- [x] Azure Container Apps deploy script exists:
  `scripts/azure/deploy-containerapp.ps1`.
- [x] Non-deploying readiness tools exist:
  `npm run azure:doctor`, `npm run online:smoke`, `npm run verify:product`.

### Verified Locally On 2026-06-22

- [x] `npm --prefix frontend run typecheck`
- [x] `npm run build`
- [x] `npm run lint`
- [x] `npm test` - 26 suites / 165 tests passed.
- [x] `npm run eval` - 13/13 eval cases passed.
- [x] `npm run stress:agents` - 13/13 stress checks passed.
- [x] `npm run audit:prod` - 0 production vulnerabilities; online registry
  audit is attempted first, with cached offline fallback only when the registry
  is unavailable.

### Current Known Caveats

- [x] Root and frontend production audits are clean through `npm run audit:prod`
  (0 vulnerabilities).
- [x] Live Azure Functions preview is deployed at
  `https://vmi-online-3907.azurewebsites.net`; `/health`, share persistence,
  Foundry smoke, telemetry, HTTPS redirect, and security headers were verified
  on 2026-06-19.
- [ ] The working tree is dirty. Ship only after reviewing, committing, and
  pushing the intended changes.
- [x] README and production-readiness docs match the Workspace + History product
  and account/POPIA model.
- [x] Older planning/reference docs no longer advertise a public Network page
  or user-facing evidence graph.
- [x] Post-redesign browser screenshots were captured against the live URL at
  desktop and mobile widths under `output/playwright/`.

## P0 - Must Finish Before Internal Live Preview

These are required before updating the real Azure/live app for owner review.

### Product Surface

- [ ] Final browser review of `/` empty, loading, result, report acknowledgment,
  `/history` empty, `/history` populated, `/s/:id`, and mobile 390px layout.
- [ ] Confirm the app still feels like a simple AI workspace: no community board,
  no visible graph, no unexplained technical language.
- [ ] Confirm copy is clear for ordinary users:
  "Check", "Report", "History", "Similar reports", "Report received".
- [x] Update README product description, endpoint table, screenshots/story, and
  eval counts to match the current product.
- [x] Update `docs/PRODUCTION_READINESS.md` stale UI notes.
- [x] Keep backend `/network/*` internal-only in public docs; `/docs` does not
  advertise the network API.

### Code And Verification

- [ ] Review the dirty worktree and separate intentional app changes from
  unrelated local files.
- [ ] Commit the current redesign and history work.
- [x] Run `npm run build`.
- [x] Run `npm run lint`.
- [x] Run `npm --prefix frontend run typecheck`.
- [x] Run `npm test`.
- [x] Run `npm run eval`.
- [x] Run `npm run stress:agents`.
- [x] Run `git grep`/secret scan for real key fragments before pushing.

### Azure Preview Readiness

- [ ] Log in to Azure CLI in the deployment terminal and set the correct
  subscription.
- [ ] Set `APPLICATIONINSIGHTS_CONNECTION_STRING` for production telemetry.
- [ ] Confirm Foundry env:
  `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT`.
- [ ] Confirm Search env if similar-report matching should use the live corpus:
  `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_INDEX`, `AZURE_SEARCH_API_KEY`.
- [ ] Confirm OCR env if file upload must work live:
  `AZURE_DOCINT_ENDPOINT`, `AZURE_DOCINT_KEY`.
- [ ] Confirm Speech env if voice must work live:
  `AZURE_SPEECH_REGION`, `AZURE_SPEECH_KEY`.
- [ ] Run `npm run azure:doctor -- --require-live` until it reports ready or all
  remaining warnings are explicitly accepted.
- [ ] Deploy to a staging/live-preview Container App with one replica.
- [ ] Run `npm run online:smoke -- --url https://<app-url> --require-foundry --require-telemetry`.
- [ ] Manually smoke test in browser:
  paste check, PDF/image upload, audio upload or recording, report submission,
  share link, history, mobile layout.

## P1 - Public Beta Blockers

These are required before real users can rely on the service.

### Accounts, Quotas, And Abuse Control

- [ ] Provision Microsoft Entra External ID tenant.
- [ ] Configure Google and Apple social sign-in in Entra.
- [ ] Configure API app registration and set `AUTH_ISSUER`, `AUTH_AUDIENCE`.
- [ ] Configure SPA auth build variables:
  `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY`, `VITE_AUTH_SCOPE`, optional
  `VITE_AUTH_REDIRECT_URI`.
- [ ] Verify frontend sign-in, sign-out, `/me` profile loading, account history,
  evidence consent, and `DELETE /me` erasure on the live origin.
- [ ] Confirm anonymous trial policy. Current backend default is 1 anonymous
  check before sign-in.
- [ ] Confirm signed-in usage policy. Current backend meters signed-in users but
  does not cap them.
- [x] Frontend account surface exists: sign-in, signed-in user menu, evidence
  consent, account deletion, account history, and admin report queue.
- [ ] Add admin role assignment and remove/empty `AUTH_ADMIN_EMAILS` after
  bootstrap.
- [ ] Decide whether to run single replica until a shared rate-limit store exists.

### Privacy And Legal

- [x] Publish an in-app privacy notice before users submit evidence.
- [x] Add terms/disclaimer: this is evidence-backed risk assessment, not a final
  accusation or legal finding.
- [x] Add explicit consent UI before storing original evidence files.
- [ ] Confirm POPIA Information Officer/contact route.
- [ ] Confirm objection/correction/deletion process for users and companies.
- [ ] Configure Cosmos PII store/data residency as designed.
- [ ] Configure Blob lifecycle deletion for consented evidence retention.
- [ ] Confirm `DELETE /me` erases account cases and evidence.
- [ ] Confirm de-identified report corpus retention policy.

### Production Data And Secrets

- [ ] Provision Key Vault.
- [ ] Move provider secrets into Key Vault references, not raw app settings.
- [ ] Set stable `AUTH_ANON_SALT` from Key Vault.
- [ ] Set `TRUST_PROXY=1`, `NODE_ENV=production`.
- [ ] Do not set `ALLOW_INSECURE=1` for public beta.
- [ ] Configure Cosmos:
  `COSMOS_CONNECTION_STRING`, optional `COSMOS_PII_CONNECTION_STRING`.
- [ ] Configure private Blob storage with managed identity or approved fallback.
- [ ] Configure Service Bus if report indexing/events should be durable.

### Monitoring And Operations

- [ ] App Insights connected and visible in `/health`.
- [ ] Dashboards for request volume, latency, error rate, engine mode,
  Foundry fallback rate, analyze timeout rate, report submissions, upload errors,
  transcription errors, and trial exhaustion.
- [x] Baseline Azure Monitor alerts for production 5xx, latency, queue backlog,
  and high 4xx volume. Configured by `npm run azure:monitor`.
- [ ] Deeper App Insights/KQL alerts for Foundry fallback, OCR/transcribe
  failures, and quota/cost anomalies.
- [x] Operator runbook for report moderation, false-positive reports, abuse,
  privacy requests, and outage handling: `docs/OPERATIONS_RUNBOOK.md`.
- [ ] Daily backup/export posture for durable stores documented.

### Reliability And Safety

- [ ] Confirm Foundry timeout/cancellation behavior under live load.
- [ ] Confirm `/chat`, `/upload`, `/transcribe`, `/report`, `/share`, `/cases`,
  and `/evidence` return typed user-safe failures.
- [ ] Decide whether long OCR/speech/analyze work can remain synchronous for beta
  or needs a job/polling path first.
- [ ] Add live smoke checks for upload, transcribe, report, share, and auth, not
  only `/analyze`.
- [x] Add route-level tests for public docs visibility, auth-disabled account
  routes, production report API-key enforcement, upload/transcribe failures, and
  analyze redaction. POPIA deletion cascade is covered in data-layer tests.
- [x] Track false positives and false negatives separately in eval reporting.

## P2 - Full Public Launch

These can follow a small public beta, but should be complete before broad
marketing or paid usage.

- [ ] Production domain and TLS configured.
- [ ] Professional landing copy or first-run explanation that does not block the
  workspace.
- [ ] Billing decision if premium is launched: Stripe or another approved provider.
- [ ] Subscription plan/limits implemented and tested.
- [ ] Feedback loop after verdict: useful, not useful, proceeded, lost money.
- [ ] Expanded synthetic and private labelled eval corpus.
- [ ] SA employer/domain allow-list for high-volume impersonation targets.
- [ ] Shortener/redirect unwrapping enabled and tested.
- [ ] WhatsApp-forwarding or lightweight mobile sharing plan.
- [ ] Support inbox/process for users who believe a result is wrong.
- [ ] Security review before increasing replicas or adding public traffic.

## Launch Decision

### Can We Deploy A Live Preview Now?

**Almost, after P0.** The app is buildable and the deploy path exists, but the
latest readiness doctor says the live environment is not ready yet because
telemetry is missing and Azure CLI is not available/logged in from this terminal.

### Can We Let The General Public Use It Now?

**Not yet.** The core investigation product and account UI are working, but
public beta needs live Entra provisioning, admin role assignment, POPIA contact
confirmation, production telemetry, durable storage configuration, and live smoke
tests against the deployed URL.

### Recommended Next Move

1. Finish and commit the current app changes.
2. Update stale docs/README to match Workspace + History.
3. Configure the missing live env, especially App Insights.
4. Run `npm run azure:doctor -- --require-live`.
5. Deploy a live-preview URL.
6. Run `online:smoke` and browser smoke tests.
7. Only then decide whether to open a small public beta.
