# Verify My Interview Trust Audit - 2026-06-20

## Scope

Comprehensive craftsmanship, security, performance, data-integrity, AI-traceability, and UX audit across the investigation workspace, upload/voice flows, `/analyze`, `/report`, `/share`, graph/Search/Cosmos, scoring, Foundry narratives, guidance citations, history, and source presentation.

Sub-agent tracks covered:

- Security/privacy/API trust boundaries
- Agent evidence traceability and hallucination resistance
- Search/network graph/data integrity
- Performance and request lifecycle
- Frontend UX/craftsmanship/accessibility

## Shipped Fixes

- Simplified voice: microphone now starts recording immediately; the visible state is waveform + timer + stop/cancel. Existing voice notes stay on the normal attachment path.
- Added explicit report confirmation before the composer files `/report`; ambiguous "I got scammed..." text no longer silently posts a community report from a single arrow click.
- Moved copy/share/read-aloud/feedback actions to the bottom of the investigation response.
- Added clear report identity (`Checked: company / role / email / domain`) so each result shows what was analyzed.
- Added trusted reference links from official guidance and positive official-domain/listing evidence, with official guidance host allowlisting.
- History now stores redacted completed `AnalyzeResponse` snapshots and can reopen original investigations without rerunning analysis.
- Added client-side in-flight dedupe for identical evidence and backend in-flight memoization for identical tool/provider calls.
- Hardened short-link unwrapping against SSRF: every hop is validated, private/local/link-local IPs are blocked, unsafe ports are blocked, and DNS failures fail closed.
- Sanitized `/share` server-side: arbitrary client JSON is rejected; stored shared results are redacted, capped, schema-minimized, and stripped of raw trace findings.
- Evidence storage now fails closed when Blob is configured but the consent store is unavailable.
- Masked provider/server exception messages before console/telemetry logging.
- Added Foundry reporter narrative validation; contradictory or unsafe model summaries fall back to deterministic conservative wording.
- `Low Risk` reports now expose no user-facing `red_flags`, removing contradictory verdict/flag combinations.
- Fixed research finding provenance so `Finding.source` stays a subsystem/tool source, not a citation URL.
- Added official FBI money-mule guidance mapping for `money_mule_request`.
- Hardened graph/network matching:
  - Canonical domain matching uses registrable-domain style normalization for common multi-part suffixes.
  - Domain matches are exact canonical matches, not substring matches.
  - Generic payment methods like "wire transfer" and "gift card: Apple" are no longer hard graph identifiers.
  - User-only duplicate reports do not become `corroborated`; an independent seed/verified/trusted anchor is required.
  - Graph derivation merges Search + Cosmos by `reportId` instead of letting Search hide Cosmos-only records.
  - Graph read endpoints use cached TTL refresh; forced writes still refresh.
  - Dirty refresh handling reruns when writes land during an active refresh.
- Account erasure now collects evidence IDs across all matching cases instead of only the first bounded page.
- Added a server-side `/analyze` deadline (`VMI_ANALYZE_TIMEOUT_MS`, default 85s) with abort propagation through the orchestrator, Foundry turns, URL unwrapping, provider adapters, Azure OpenAI embeddings, Azure Search, and web/phone/domain/company checks.
- Changed free-trial/usage accounting to reserve anonymous access before analysis, roll it back on validation/timeout/failure, meter uncapped signed-in usage only after a successful completed investigation, and enforce capped signed-in beta quotas with reservation/rollback.
- Added a durable Cosmos graph-revision marker so replicas can detect report-corpus changes even when a Service Bus event is missed or a local graph cache is still warm.
- Made production `/report` fail closed unless `VMI_REPORT_API_KEY` is configured or `VMI_ALLOW_PUBLIC_REPORTS=1` is set deliberately; the production boot guard enforces that policy.
- Added a public-report moderation queue: untrusted public reports are stored as `pending_review` and do not enter Search, Cosmos graph intelligence, or scoring until an admin approves them. Admins can list pending reports and approve/reject them through guarded moderation endpoints.

## New Regression Detectors

- `tests/unit/entityGraph.test.ts`: canonical domain behavior, payment-handle filtering, user-only duplicate poisoning, independent-anchor promotion.
- `tests/unit/urlUnwrap.test.ts`: short-link SSRF guard for localhost/private redirects and safe public redirects.
- `tests/unit/sharedSanitizer.test.ts`: `/share` schema minimization, redaction, raw trace removal, malicious citation URL dropping.
- `tests/unit/guidanceCoverage.test.ts`: every emitted red signal must map to official guidance.
- `tests/unit/reporterAgent.test.ts`: mocked Foundry contradiction/unsafe-action fallback.
- Updated `tests/unit/networkAgent.test.ts`: repeated unverified network reports no longer score as infrastructure corroboration.
- Updated `tests/unit/authMiddleware.test.ts`: failed anonymous analysis releases its reserved trial.
- Added `tests/unit/analyzeAccessAccounting.test.ts`: signed-in usage is metered only on commit, capped reservations are not double-metered, signed-in quota rollback is idempotent, disabled accounting stays quiet, and anonymous rollback is idempotent.
- Added `tests/unit/analyzeAbort.test.ts`: pre-aborted local/orchestrator analysis stops before pipeline work and tool calls do not reach providers after abort.
- Updated `tests/unit/cosmos.test.ts`: anonymous rollback and graph revision marker coverage.
- Updated `tests/unit/securityConfig.test.ts`: production report-write policy coverage.
- Added `tests/unit/reportModeration.test.ts`: public report queueing, trusted API-key ingestion, pending listing, approval, and rejection coverage.
- Added `tests/unit/serverRoutes.test.ts`: public docs visibility, analyze/report boundary validation, production report API-key enforcement, upload/transcribe file failures, account fail-closed behavior when auth is disabled, and `/analyze` response redaction.
- Updated offline eval reporting to track false positives and false negatives separately, and to restore/scrub env safely so local `.env` values cannot leak live providers into deterministic gates.
- Tightened offline stress/eval mode with `VMI_EXTERNAL_LOOKUPS_DISABLED`, env-gated registry lookup, bounded DNS resolver attempts, and fast provider skips under restricted-network test runs.

## Verification

`npm run verify:product` passed.

- Backend build: pass
- Frontend build: pass
- ESLint: pass
- Frontend typecheck: pass
- Jest: 26 suites, 165 tests passed
- Offline evals: 13/13 passed, false positives 0, false negatives 0
- Agent stress: 13/13 passed
- Production npm audits: 0 vulnerabilities through `npm run audit:prod` (online audit first; cached offline fallback only when the registry is unavailable)

Note: frontend install still reports existing dev-only audit advisories before the production audit step; the production `--omit=dev` audits are clean.

## Operator-Gated Release Checks

- Browser visual review was not run because the project preference says not to auto-start servers. Run screenshots at 1440px and 390px before the next live deployment.
- No live deployment was performed as part of this audit pass.
