# Data Architecture & POPIA Design — Full-Platform Plan

Status: **DESIGN (pre-build)** · Created 2026-06-16 · Owner decision required on the
items marked **[DECISION]**. This is the design step for the user-approved "full
platform" direction: persistent **Cosmos DB** (users, companies, reports, audit,
trust) + **Blob Storage** (evidence files) + **Service Bus/Event Grid** (events),
on the canonical Express-on-Container-Apps runtime.

> This reverses the app's current **stateless, PII-minimal** posture (no accounts,
> evidence never stored — CLAUDE.md rule 4 / decision D2). Everything below is
> engineered so that NOT configuring a data service keeps today's behaviour
> (graceful degradation, rule 2) and offline evals stay deterministic (rule 3).

## 1. Identity, authentication & subscription tiers  — DECIDED 2026-06-16

Frictionless, ChatGPT/Claude-style onboarding — **no usernames/passwords**.

- **Microsoft Entra External ID (CIAM)** with **Google** and **Apple** as social
  identity providers (both are first-class Entra External ID social IdPs). The API
  validates the JWT; Microsoft handles credential security. Sign-up/login in seconds.
- **Roles:** `user` (free) → `premium` → `analyst`/`admin` (future).
- **Freemium model:**
  - **Free tier** — a limited number of verification checks (limit **[DECISION: exact
    number TBD]**, enforced per user per rolling period).
  - **Premium tier** — affordable subscription: **unlimited** checks, priority access
    to new features, future premium capabilities.
  - Requires: a `subscription` block on `users` (plan, status, renewal), a `usage`
    record (checks consumed in the period), enforcement at `/analyze`, and a
    **payment provider [DECISION]** (recommend **Stripe** — mature, SA-supported,
    simple webhooks; alternative: Azure Marketplace SaaS offers / Paddle).
- **Anonymous trial:** to keep onboarding effortless we MAY allow a tiny
  unauthenticated trial (e.g. 1 check) before prompting sign-in **[DECISION]**;
  otherwise sign-in (Google/Apple) is required and still takes seconds.

## 2. POPIA compliance (non-negotiable, SA users)

| Principle | Design |
|---|---|
| Lawful basis | **Consent** (explicit) for account data + evidence retention; **legitimate interest** for the de-identified community scam corpus (fraud prevention). |
| Minimisation | Keep the existing redaction boundary (`redactSensitiveIdentifiers` at `/analyze`, `redactAndCap` at `/report`). Store evidence files ONLY with explicit consent, tied to a case. |
| Retention | Anonymous verifications: **not persisted**. Consented evidence: **12 months** then auto-deleted (or on user erasure). Community reports: retained indefinitely **because they are de-identified** (IOCs only, reporter PII stripped). Audit logs: **90 days**, content-free. _(DECIDED 2026-06-16)_ |
| Right to erasure | Delete account → cascade-delete the user's `cases` + their Blob evidence. Community `reports` remain (no PII). Implemented as an explicit erasure endpoint + a Blob lifecycle rule. |
| Encryption | At rest: Cosmos + Blob platform encryption (default), optional **customer-managed key** in Key Vault. In transit: TLS only. |
| Access control | **Managed identity + RBAC data-plane** everywhere; no keys in code; provider secrets in **Key Vault**. Evidence downloads proxied through the API (audited), not public SAS. |
| Data residency | **PII stores (`users`, `cases`, evidence Blob) → South Africa North** for in-country residency _(DECIDED 2026-06-16)_. Non-PII corpus (`reports`, `companies`, `trustScores`, content-free `auditLogs`) stays in `eastus2`, co-located with the app + Search + Foundry IQ (hot path). |

## 3. Cosmos DB (system of record) — Mongo API, **serverless**

Cosmos becomes the **source of truth**; Azure AI Search (`scam-reports-v2`) and the
new Foundry IQ KB (`vmi-scam-kb`) become **derived query indexes** fed from Cosmos
(see §5 events). This is the standard "Cosmos = truth, Search = index" pattern and
removes the current "Search is the only store" fragility.

| Collection | Purpose | Partition key | PII? |
|---|---|---|---|
| `users` | Account profile, consent flags, prefs | `/id` (Entra subject) | yes (consented) |
| `cases` | A user's verification cases: evidence refs, report snapshot, retentionExpiry | `/userId` | yes (consented) |
| `reports` | Community scam corpus (redacted IOCs, trust) — today's `NetworkReport` | `/reportId` | **no** (de-identified) |
| `companies` | Resolved company entities | `/id` | no |
| `trustScores` | Per-entity trust (entity, type, level, points, lastComputed) | `/entityId` | no |
| `auditLogs` | Content-free request audit (method, path, status, latency, ipHash, ts) | `/day` | no (ip hashed) |

- `reports`/`companies`/`trustScores`/`auditLogs` carry **no PII** → build these
  first (no auth/consent dependency). `users`/`cases` come with auth + consent.
- Access: **env-gated** (`COSMOS_*` unset → fall back to in-memory + seed corpus +
  Search, exactly as today). Data-access layer behind an interface so the pipeline
  is unchanged. Deterministic scorer/eval path never touches Cosmos.

## 4. Blob Storage — evidence files

- Dedicated account (or reuse `vmifunc3907sa`), **private** container `evidence`,
  path `{userId}/{caseId}/{fileId}`, server-side encryption, **no public access**.
- Stored ONLY on the consented path; the anonymous/no-consent analyze flow stays
  ephemeral (OCR/transcribe in memory → discard, as today). Reuse the existing
  magic-byte sniffing before persisting.
- Download via API proxy using managed identity (audited) — not public SAS.
- **Lifecycle rule** auto-deletes blobs past the retention window (POPIA).

## 5. Events — Service Bus + Functions consumers

- **Service Bus topic `vmi-events`** (reliable, ordered, dead-letter) for internal
  work; Event Grid optional for reactive fan-out later.
- Events: `report.created`, `trustscore.updated`, `fraud.detected`.
- **Consumer = Azure Functions** (the consumer role we reserved when we removed the
  duplicate HTTP Functions): on `report.created` → re-index Search + Foundry IQ KB
  + rebuild the entity-graph slice + recompute trust; on `fraud.detected` → flag/notify.
- This decouples write latency from indexing and is where Functions correctly returns.

## 6. Security & ops

- Managed identity for the Container App → Cosmos (Cosmos DB Built-in Data
  Contributor), Blob (Storage Blob Data Contributor), Service Bus (Sender/Receiver),
  Search, Foundry. **Key Vault** for provider API keys (WHOIS/Abstract/SerpAPI).
- App Insights already wired — extend with the new dependencies' telemetry.
- All new endpoints keep the existing hardening (rate limit, CSP, body cap, sniffing).

## 7. Build sequence (each slice: env-gated, graceful degradation, gates stay green, verified against real resources)

1. ✅ **Cosmos foundation (non-PII):** serverless Cosmos data-access layer
   (`data/cosmos.ts`); `reports` is the durable system of record (Search = derived
   index); shared-report results with TTL. Offline path unchanged. _(implemented)_
2. ✅ **Event backbone:** Service Bus queue (`events/serviceBus.ts`) + in-process
   consumer; `report.created` → entity-graph refresh. _(implemented)_
3. ✅ **Auth + FREE tier (premium deferred):** Entra External ID JWT validation
   (`auth/identity.ts`, Google/Apple as Entra social IdPs); `attachIdentity` +
   `enforceAnalyzeAccess` + `requireAuth` (`auth/middleware.ts`); `users` + `cases`
   + `usage` collections (PII-residency hook `COSMOS_PII_CONNECTION_STRING` → SA
   North, falls back to main); consent capture on `users`; **usage metering** at
   `/analyze`. **Policy (decided 2026-06-18):** signed-in = **unlimited** (metered,
   not capped); anonymous = **1 trial check** (`AUTH_ANON_TRIAL_MAX`) then sign-in.
   **Deferred:** premium tier, **billing (Stripe)**, and the usage hard-cap (the
   meter is in place to switch it on without migration). _(implemented)_
4. ✅ **Evidence Blob:** consented private storage (`storage/blob.ts`, managed
   identity or connection string), ownership-scoped reads, erasure via `DELETE /me`.
   12-month retention = a Blob lifecycle rule (infra). _(implemented)_
5. ⬜ **Frontend:** Google/Apple sign-in, account UI, case history, consent flows;
   optional SWA/Vercel split. _(not started — out of current backend scope)_

**Endpoints added (slices ③–④):** `GET /me`, `DELETE /me` (self-service erasure),
`PUT /me/consent` (evidence-storage consent), `GET /cases`, `GET /cases/:id`,
`POST /evidence`, `GET /evidence/:fileId`, and `DELETE /reports/:id` (admin
moderation). All require a valid bearer token; all degrade to 503 when their
backing service is unconfigured.

**AuthN vs AuthZ (explicit, least-privilege):** authentication (a valid Entra token)
proves WHO the caller is; authorization decides what they may do.
- **Self-service** actions (`DELETE /me`, `GET /cases`, evidence read/write) are scoped
  to the caller's own `userId` — a user can only ever touch their OWN data; there is no
  `userId` parameter to spoof.
- **Destructive cross-user / shared-data** actions (`DELETE /reports/:id`) require the
  **`admin` app-role** (`requireAdmin` → 403 otherwise). Roles come from the token's
  `roles` claim ONLY — never from a `users` document — so DB tampering cannot escalate
  privilege. Fails closed: with no admin assigned, no one can delete community data.
- **Consent gate:** `POST /evidence` refuses (403) until the user has recorded explicit
  consent via `PUT /me/consent` (POPIA lawful basis for evidence retention).

**Provisioning still required to run these LIVE:** an Entra External ID tenant + app
registration (set `AUTH_ISSUER`/`AUTH_AUDIENCE`), Google + Apple social connections in
Entra, and a Storage account (`AZURE_STORAGE_ACCOUNT` + managed-identity RBAC, or a
connection string). Until then the code is inert and the app runs exactly as before.

## 8. Decisions

**Resolved 2026-06-16:** auth = Entra External ID with **Google + Apple** social
sign-in (frictionless, no passwords); **freemium** (limited free checks + unlimited
premium); PII residency = **South Africa North**; retention = **12 months evidence /
90 days audit**.

**Still open (gate slices ③–④ only — slices ①–② can proceed now):**
- **[DECISION]** Free-tier check limit (exact number per period).
- **[DECISION]** Payment provider (recommend **Stripe**).
- **[DECISION]** Allow a tiny anonymous trial (e.g. 1 check) before sign-in, or require
  Google/Apple sign-in up front?

Build starts at slice ① (non-PII Cosmos foundation in `eastus2`) — needs none of these.
