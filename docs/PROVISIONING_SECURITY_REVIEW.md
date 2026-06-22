# Provisioning as Security Review — Entra External ID, Storage, Key Vault

Status: **checklist (pre-provisioning)** · Owner: platform · Companion to
`docs/DATA_ARCHITECTURE.md`.

This treats the remaining Azure setup (Entra External ID, app registration, roles,
Storage, Key Vault, managed identity) as a **security-architecture exercise, not a
deployment chore**. Each item names the control it enforces and the engineering
principle behind it (least privilege, fail-fast, explicit-over-implicit, defence in
depth). The app is **inert** until these env vars are set; the runtime **refuses to
boot** in production if the security-critical ones are missing (`config/security.ts`
→ `assertSecureConfig`).

Legend: **[now]** do before/at provisioning · **[launch]** before public launch ·
**[post]** acceptable to defer, but ticket it.

---

## 1. Identity — Microsoft Entra External ID (CIAM)

- **[now]** Create the External ID tenant. Add **Google** and **Apple** as social
  identity providers (so the API trusts exactly ONE issuer — Entra). _Control:_
  single trusted issuer; credential security delegated to Microsoft.
- **[now]** Register the API application. Record the **issuer** (`AUTH_ISSUER`,
  e.g. `https://<tenant>.ciamlogin.com/<tenantId>/v2.0`) and the **audience**
  (`AUTH_AUDIENCE` = the API's application/client id).
- **[now]** Register the SPA as a **public client using PKCE** (no client secret in
  a browser). Restrict **redirect URIs** to the exact app origins — no wildcards.
  _Control:_ auth-code interception / open-redirect resistance.
- **[now]** Define an **`admin` app role** in the API app manifest (value `admin`).
  This is the PRIMARY authorization mechanism. _Control:_ authZ in the verified
  token, managed in Entra, out of app config (auditable, revocable centrally).
- **[launch]** Assign the `admin` role to the one or two operators who need it.
  Then **clear `AUTH_ADMIN_EMAILS`** — it is a temporary break-glass bootstrap only
  (every use is logged: `[Auth] admin action authorized via break-glass…`). The
  prod boot already warns when it is non-empty.
- **[now]** Confirm token shape: v2.0 tokens, `roles` claim emitted for assigned
  app roles, `email`/`preferred_username` present (needed for the break-glass path
  and audit). Keep token lifetime default; the API enforces 5s clock skew only.
- _Verification:_ a token with no `admin` role → `DELETE /reports/:id` returns 403;
  with the role → 200. An expired/forged token → 401 on any authed route.

## 2. Authorization model (decided)

- **Primary:** Entra `admin` app role (`roles` claim). **Fallback:** `AUTH_ADMIN_EMAILS`
  (verified-email allow-list), temporary, logged on every use, empty in steady state.
- **Self-service vs admin:** self-service routes (`DELETE /me`, `/cases`, evidence)
  are scoped to `req.identity.userId` — no spoofable id param. Only destructive /
  shared-data actions (`DELETE /reports/:id`) require `requireAdmin`. _Principle:_
  least privilege; explicit over implicit.

## 3. Storage — evidence Blob (PII)

- **[now]** Dedicated Storage account, **South Africa North** (PII residency).
- **[now]** Private container `evidence`; **public blob access disabled** at the
  account level. _Control:_ no anonymous/public reads, ever.
- **[now]** **Managed identity**, not a connection string, in production: assign the
  app's identity **Storage Blob Data Contributor** scoped to this account only. Set
  `AZURE_STORAGE_ACCOUNT` (the code uses `DefaultAzureCredential`). Leave
  `AZURE_STORAGE_CONNECTION_STRING` for local/dev only. _Principle:_ least privilege,
  no secrets in app settings.
- **[now]** Network: restrict to the app's VNet/private endpoint or the platform's
  outbound IPs; deny public network access where feasible.
- **[launch]** **Lifecycle management rule** to auto-delete blobs after the retention
  window (POPIA 12 months) — complements the in-app erasure on `DELETE /me`.
- _Verification:_ `GET /evidence/:fileId` for another user's file → 404 (ownership is
  prefix-scoped, unit-tested); the container is not publicly listable.

## 4. Secrets — Key Vault

- **[now]** Create a Key Vault; grant the app's managed identity **get/list secrets**
  only. _Principle:_ least privilege.
- **[now]** Store there (NOT in app settings) and reference at deploy time:
  - `COSMOS_CONNECTION_STRING` / `COSMOS_PII_CONNECTION_STRING` — **honest limitation:**
    Cosmos for the **MongoDB API has no AAD data-plane RBAC**, so its credential is a
    key. Key Vault + rotation is the mitigation; do not paste it into app config.
  - Provider keys: `WHOISJSON_API_KEY`, `ABSTRACT_*`, `SERPAPI_API_KEY`, etc.
  - `AUTH_ANON_SALT` — a stable random value so anon-trial hashes survive restarts.
  - `AUTH_SIGNED_IN_MONTHLY_MAX` — the public-beta monthly free-check cap.
- **[post]** Enable Key Vault secret rotation reminders / events.

## 5. Cosmos DB

- **[now]** PII collections (`users`, `cases`, `usage`) → **South Africa North**
  account via `COSMOS_PII_CONNECTION_STRING`; non-PII corpus stays in the main
  (eastus2) account. The code already routes by collection.
- **[now]** Cosmos firewall: allow only the app's outbound IPs / private endpoint;
  deny public network where feasible.
- **[now]** TTL indexes are created by the app (`shared_reports`, `anon_trials`,
  `cases`); confirm they exist after first connect.

## 6. Service Bus & event consumer

- **[now]** **Managed identity** (Service Bus Data Sender/Receiver) instead of a
  connection string where the SDK/tier supports it.
- **[post]** Move the in-process consumer to an **Azure Functions consumer** with the
  queue's **dead-letter** + a periodic **Cosmos→Search/Foundry-IQ reconciliation** job.
  _Reason:_ the current in-process consumer can drop a `report.created` on instance
  death, drifting the derived indexes from the source of truth.

## 7. Runtime hardening & observability (App Service / Container Apps)

- **[now]** `NODE_ENV=production` and **`TRUST_PROXY=1`** (behind ingress, so rate
  limiting + the anon-trial gate use the real client IP, not the proxy hop).
- **[now]** Set `AUTH_ISSUER`, `AUTH_AUDIENCE`, `COSMOS_CONNECTION_STRING`,
  `AUTH_ANON_SALT`, `AUTH_SIGNED_IN_MONTHLY_MAX`,
  `APPLICATIONINSIGHTS_CONNECTION_STRING`. The server **refuses to boot** without
  the security-critical ones (unless `ALLOW_INSECURE=1`, an audited emergency
  escape hatch). _Principle:_ fail fast over silent degradation.
- **[now]** Single replica until a **shared rate-limit/anon-trial store** exists, OR
  accept that per-IP limits multiply per replica (`http/guard.ts` notes the Redis
  swap). The durable anon-trial path (Cosmos) already works cross-replica; only the
  in-memory fallback is per-process — and prod requires Cosmos anyway.
- **[now]** Confirm always-on HTTP controls remain enforced: rate limiting, strict
  CSP + security headers, body-size caps, magic-byte upload sniffing, content-free
  audit log (salted IP hash), typed JSON errors (no stack traces in prod).
- **[decision]** **CORS:** none today (same-origin SPA served by Express — safest).
  If the frontend moves to SWA/Vercel, add a strict origin **allow-list** and widen
  the CSP `connect-src`. Auth is Bearer-header (not cookies) so CSRF is N/A — keep it
  that way; revisit if cookie auth is ever introduced.

## 8. Post-launch backlog (tickets, not blockers)

- Shared rate-limit store (Redis) for horizontal scale.
- Functions event consumer + dead-letter + reconciliation job.
- Stable audit-log salt from Key Vault (cross-replica abuse correlation).
- Premium tier + billing.

---

### Pre-launch verification (run after provisioning)

1. `assertSecureConfig` passes with the prod env (server boots; no `[Config]` hard
   failures). Removing `TRUST_PROXY` or auth vars → boot **refused** (already
   runtime-verified in dev).
2. Anonymous `/analyze` allowed once per client IP, then `401 trial_exhausted`.
3. Signed-in `/analyze` respects `AUTH_SIGNED_IN_MONTHLY_MAX`; `GET /me` shows
   incrementing usage.
4. `DELETE /reports/:id`: 403 for non-admin, 200 for the `admin` role; break-glass
   use logged.
5. Cross-user `GET /evidence/:fileId` → 404. `DELETE /me` removes cases + blobs.
6. `GET /health` reports `accounts: true`, `evidence_storage: true`.
