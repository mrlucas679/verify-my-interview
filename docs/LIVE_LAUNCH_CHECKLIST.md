# Live Launch Checklist

Status: live preview deployed and custom domain configured on 2026-06-22.
Created 2026-06-18 after the Investigation Workspace + History redesign.

This list separates two launch moments:

- **Internal live preview:** deploy the current app to a real Azure URL so the
  owner can inspect it on phone/desktop and verify the real services.
- **Public beta:** allow real job seekers to use it safely, with auth, quotas,
  privacy controls, monitoring, and an operator path.

Do not call the app public-launch ready until every **Public beta blocker** is
closed or explicitly accepted in writing.

## Current Live State

- [x] Azure App Service live URL:
  `https://vmi-online-3907.azurewebsites.net`.
- [x] Custom domain and App Service managed TLS:
  `https://app.verifymyinterview.co.za`.
- [x] `npm run azure:continue-live` completed on 2026-06-22.
- [x] `npm run azure:doctor -- --require-live` reported `READY`.
- [x] `npm run online:smoke -- --url https://vmi-online-3907.azurewebsites.net --require-foundry --require-telemetry`
  reported `READY`.
- [x] Smoke cases passed against live Azure: upfront-fee scam, clean interview
  invite, and spoken scam report.
- [x] DNS records verified locally:
  `app.verifymyinterview.co.za` CNAME to `vmi-online-3907.azurewebsites.net`
  and `asuid.app.verifymyinterview.co.za` TXT verification.
- [x] `npm run azure:domain -- -HostName app.verifymyinterview.co.za`
  completed and bound the managed certificate.
- [ ] Run the fixed live UI verifier against the custom domain:
  `npm run azure:verify-live-ui -- -Url https://app.verifymyinterview.co.za`.
- [ ] Owner visual pass on the custom domain: desktop, mobile, paste check,
  report mode, file upload, voice, share link, history, and sign-in.

## Current Product Shape

### Implemented

- [x] Single AI-first Investigation Workspace at `/`.
- [x] One composer for pasted text, emails, links, PDFs, screenshots, text files,
  uploaded audio, and recorded voice.
- [x] Verify mode returns a conversational investigation response with compact
  inline evidence and actions at the bottom.
- [x] Report mode returns only an acknowledgment and reference id, not a verdict.
- [x] ChatGPT-style history exists as a compact desktop rail and mobile
  `/history` list, replacing the old community/network screen.
- [x] `/network` redirects to `/history` so old links do not expose graph UI.
- [x] Graph UI and `react-force-graph-2d` frontend dependency removed.
- [x] Similar prior reports are summarized inside the conversation instead of
  exposed as a separate community/network surface.
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
- [x] Existing App Service/Functions live deploy tool exists:
  `npm run azure:deploy:appservice`.

### Verified Locally On 2026-06-22

- [x] `npm --prefix frontend run typecheck`
- [x] `npm run build`
- [x] `npm run lint`
- [x] `npm test` - 27 suites / 176 tests passed.
- [x] `npm run eval` - 13/13 eval cases passed.
- [x] `npm run stress:agents` - 13/13 stress checks passed.
- [x] `npm run audit:prod` - 0 production vulnerabilities; online registry
  audit is attempted first, with cached offline fallback only when the registry
  is unavailable.

### Current Known Caveats

- [x] Root and frontend production audits are clean through `npm run audit:prod`
  (0 vulnerabilities).
- [x] Live Azure Functions/App Service preview is deployed at
  `https://vmi-online-3907.azurewebsites.net`; Foundry smoke, telemetry,
  durable store readiness, auth readiness, and online smoke were verified on
  2026-06-22.
- [x] Custom domain is configured at `https://app.verifymyinterview.co.za`.
- [ ] The working tree is dirty. Ship only after reviewing, committing, and
  pushing the intended changes.
- [x] README and production-readiness docs match the Workspace + History product
  and account/POPIA model.
- [x] Older planning/reference docs no longer advertise a public Network page
  or user-facing evidence graph.
- [ ] Fresh custom-domain browser screenshots must be captured with
  `npm run azure:verify-live-ui -- -Url https://app.verifymyinterview.co.za`.

## P0 - Must Finish Before Internal Live Preview

These were required before updating the real Azure/live app for owner review.

### Product Surface

- [ ] Final browser review of `/` empty, loading, result, report acknowledgment,
  reopened check history, reopened report history, `/history` empty,
  `/history` populated, `/s/:id`, and mobile 390px layout.
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

- [x] Log in to Azure CLI in the deployment terminal and set the correct
  subscription.
- [x] Set `APPLICATIONINSIGHTS_CONNECTION_STRING` for production telemetry.
  It must be the real Azure Monitor connection string containing
  `InstrumentationKey=`, not a copied placeholder.
- [x] Confirm Foundry env:
  `AZURE_AI_PROJECT_ENDPOINT`, `AZURE_AI_MODEL_DEPLOYMENT`.
- [x] Confirm Search env if similar-report matching should use the live corpus:
  `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_INDEX`, `AZURE_SEARCH_API_KEY`.
- [ ] Confirm OCR env if file upload must work live:
  `AZURE_DOCINT_ENDPOINT`, `AZURE_DOCINT_KEY`.
- [ ] Confirm Speech env if voice must work live:
  `AZURE_SPEECH_REGION`, `AZURE_SPEECH_KEY`.
- [x] Run `npm run azure:doctor -- --require-live` until it reports ready or all
  remaining warnings are explicitly accepted.
- [x] Deploy to the existing App Service/Functions live-preview app with
  `npm run azure:deploy:appservice`, or deploy a staging Container App with one
  replica when moving to the container runtime.
- [x] Run `npm run online:smoke -- --url https://<app-url> --require-foundry --require-telemetry`.
- [ ] Manually smoke test in browser:
  paste check, PDF/image upload, audio upload or recording, report submission,
  share link, history, mobile layout.

## P1 - Account-Based Public Beta Blockers

These are required before opening sign-in/account features to ordinary job
seekers. They are not required for a small anonymous public preview, where users
can run the free trial and submit reports without creating an account.

### Accounts, Quotas, And Abuse Control

- [ ] Provision Microsoft Entra External ID tenant for true public Google/Apple
  sign-in. The current live automation can create an Entra app registration in
  the existing tenant, which is acceptable for owner preview but not the final
  consumer identity experience.
- [ ] Configure Google and Apple social sign-in in Entra External ID.
- [x] Configure API app registration and set `AUTH_ISSUER`, `AUTH_AUDIENCE`.
- [x] Configure SPA auth build variables:
  `VITE_AUTH_CLIENT_ID`, `VITE_AUTH_AUTHORITY`, `VITE_AUTH_SCOPE`, optional
  `VITE_AUTH_REDIRECT_URI`.
- [ ] Verify frontend sign-in, sign-out, `/me` profile loading, account history,
  evidence consent, and `DELETE /me` erasure on the live origin.
- [x] Confirm anonymous trial policy. Current backend default is 1 anonymous
  check before sign-in.
- [x] Signed-in quota enforcement implemented. Set `AUTH_SIGNED_IN_MONTHLY_MAX`
  to a positive monthly cap before public beta; production refuses auth-enabled
  startup without it.
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
- [x] Set stable `AUTH_ANON_SALT` for the live deployment.
- [x] Set `AUTH_SIGNED_IN_MONTHLY_MAX` to the public-beta monthly free-check cap.
- [x] Set `TRUST_PROXY=1`, `NODE_ENV=production`.
- [ ] Do not set `ALLOW_INSECURE=1` for public beta.
- [x] Configure Cosmos:
  `COSMOS_CONNECTION_STRING`, optional `COSMOS_PII_CONNECTION_STRING`.
- [ ] Configure private Blob storage with managed identity or approved fallback.
- [ ] Configure Service Bus if report indexing/events should be durable.

### Monitoring And Operations

- [x] App Insights connected and visible in live readiness checks.
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

These can follow the account-based public beta. Complete them before broad
marketing, paid usage, multiple replicas, or treating the service as a mature
consumer product.

- [x] Production domain and TLS configured:
  `https://app.verifymyinterview.co.za`.
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

**Yes.** Live preview is deployed on Azure and the custom domain is configured:
`https://app.verifymyinterview.co.za`.

### Can We Let The General Public Use It Now?

**Public preview without consumer accounts: yes after the fixed live UI verifier
and owner browser smoke pass.** The app has live Foundry, telemetry, Cosmos,
quota defaults, public report intake, and a custom domain. In this mode, users
can check one case anonymously and submit reports, while account history and
signed-in quotas stay secondary until sign-in is verified.

**Account-based public beta: next, but gated by identity verification.** The
code and deployment automation now create the Entra app registration,
`AUTH_AUDIENCE`, and `VITE_AUTH_*` settings. Before advertising accounts to
ordinary job seekers, verify sign-in/sign-out on
`https://app.verifymyinterview.co.za`, assign the admin role, and either finish
External ID Google/Apple social login or explicitly accept Microsoft-only sign-in
for the first beta cohort.

**Full public launch: later.** That is the P2 milestone: Key Vault secret
migration, confirmed POPIA contact route, broader live smoke coverage for
upload/transcribe/report/share/auth, production dashboards, support process, and
the growth features listed above.

### Recommended Next Move

1. Run `npm run azure:verify-live-ui -- -Url https://app.verifymyinterview.co.za`.
2. Owner opens `https://app.verifymyinterview.co.za` on phone and desktop.
3. Smoke test paste check, report mode, upload, voice, share, history, and
   sign-in.
4. Review/commit/push the intended launch changes.
5. Open a small monitored public preview.
6. Turn on account-based public beta only after the P1 identity/sign-in checks
   pass on the custom domain.
