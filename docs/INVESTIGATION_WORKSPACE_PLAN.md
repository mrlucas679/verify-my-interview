# Investigation Workspace — End-to-End Implementation Plan

Status: **IMPLEMENTED / SUPERSEDED BY LIVE WORKSPACE** · 2026-06-18 · Owner:
design+frontend (delegated full control by user)
Branch: `integration/combined-20260612` (main untouched until explicitly told)

The split `/` (Verify) and `/report` (dossier) flow has been collapsed into ONE
AI-first **Investigation Workspace**. The public product now has a simple
workspace plus History. The scam-intelligence graph/network remains an internal
matching layer, not a page users need to understand.

## 0. Principles this plan is held to (non-negotiable)
- **Sentinel design** (`sentinel-ui`) + **impeccable-design** quality bar. No emojis,
  no chatbot fluff, no `dangerouslySetInnerHTML`. Dark fraud-ops console.
- **Security-first / POPIA:** React auto-escaping only; no token or PII in URLs or
  `localStorage` beyond what's required; client validation is defense-in-depth, the
  server stays authoritative; CSP updated deliberately for the login origin.
- **Graceful degradation:** every capability is probed via `GET /health`; affordances
  that aren't configured (OCR, voice, accounts, sharing) are hidden, not broken.
- **Fail-fast where it matters:** typed API errors surfaced as operational copy.
- **Power-of-Ten / KISS / DRY:** small components, bounded lists, one state store,
  reuse existing cards. Each phase ships behind green gates + a preview check.

## 1. Information architecture (routes)
| Route | Purpose | Notes |
|---|---|---|
| `/` | Investigation Workspace (empty → active) | replaces Verify + Report pages |
| `/history` | Past checks and signed-in case snapshots | replaces the old Network/community surface |
| `/s/:id` | Public shared result (read-only) | exists; reuse |
| `/admin/reports` | Moderator report queue | `requireAdmin` |
| `/privacy` and `/terms` | POPIA notice and product terms | public, plain language |
| `/network` | Redirects to `/history` | old links do not expose graph UI |
| `*` | redirect → `/` | old `/report` redirects into `/` |

Top nav (`Layout.tsx`): logo · **New check** · History · [signed-in: account
menu] · [admin: Reports]. Footer: privacy + terms.

## 2. Screen anatomy
### 2.1 Empty / first-run state
- Centered composer with `font-display` h1 ("Check a job, recruiter, or offer before you
  trust it") + one-line subtext. `eyebrow` capability row (icons: paste · screenshot ·
  PDF · voice). 3–4 example chips (from `lib/samples.ts`) that prefill the composer.
- A quiet "how this works" disclosure (transparency = trust). No marketing gradients.

### 2.2 Composer (persistent, bottom-anchored once active)
- One `textarea` (auto-grow, hard cap = `MAX_LOCAL_EVIDENCE_CHARS` 40k, live counter near
  limit). Enter submits; Shift+Enter newline; paste of a URL/email shows a recognized-entity
  chip inline.
- **Attachments:** drag-drop + file picker + paste-image. Chips show name/size/type with
  remove + thumbnail (images). Client-side validation mirrors server (type sniff by
  extension/MIME hint, size: 8 MB docs / 25 MB audio) — server remains authoritative.
- **Voice:** `VoiceRecorder` inline (mic → waveform → stop → transcribing → editable text).
  Hidden when `/health.voice_transcription` is false.
- **Mode control:** segmented `Verify` (default) / `Report a scam`. When the draft text
  matches "already paid / lost money / sent ID" heuristics, show a non-blocking suggestion
  chip → switches to Report on tap (never auto-switches).
- Submit button state machine: idle → validating → submitting (cancelable).

### 2.3 Active workspace (card stack)
Reverse-not — newest case at top, its cards stack in investigation order. Each submission
creates a **case group**: the user's evidence summary (collapsed) + the result cards.

### 2.4 Live progress
While `/analyze` runs: a **pipeline status strip** replays real stages (`InvestigationLayers`)
with operational copy ("Running domain verification · 4 tools called"), plus skeleton cards.
Respect `prefers-reduced-motion`. A **Cancel** aborts the request (AbortController already in `api.ts`).

## 3. The intelligence card (the core primitive)
`<IntelCard>` wrapper: header = type icon (lucide) + title + right-aligned action menu
(expand/collapse · copy · share · save). Body = the typed content. Collapsed by default for
secondary cards; verdict expanded. Expansion state per-card (session). Motion: opacity/transform
reveal only (Sentinel rule). Card types (reuse existing components as the body):

| Card | Source component | Default |
|---|---|---|
| Verdict (risk level, score, confidence) | `VerdictCard` | expanded |
| Findings (red flags / positives / verified) | `Findings` | expanded |
| Network matches (similar reported scams) | `NetworkMatches` | collapsed |
| Official guidance citations | `GuidanceCitations` | collapsed |
| Evidence & entities recognized | new small card | collapsed |
| Ask the detective (follow-ups) | `ChatPanel` inline | pinned at bottom of group |

**Action semantics:**
- **Copy** → plain-text digest of that card (no PII beyond what's already shown).
- **Share** → whole case via `POST /share` → unguessable `/s/:id` link + "expires in N days"
  toast. (Per-card share = Phase 7.)
- **Save** → persist to history; if anonymous, opens the sign-in prompt (Phase 4) then `/cases`.

## 4. Report mode (distinct contract)
On submit in Report mode: a single **acknowledgment card** —
- "Thank you. Your report has been received." + **reference id** (the `reportId`).
- 2–3 concrete **safety next-steps** (do not send money/ID; contact bank if you paid;
  preserve evidence) — modeled on FTC/IC3 "what to do next".
- One optional secondary action: **"Also check this for me"** → re-runs the same evidence
  through Verify (trauma-informed: choice, never a dead end).
- NO verdict, score, or findings shown. The investigation runs **silently** server-side:
  store → pipeline → company research → similar-scam search → Intelligence Network update →
  moderator queue.
- Anonymous users may report; reports enter `unverified` → moderation (no network poisoning).

## 5. Authentication & account UX (Phase 4) — implemented 2026-06-20
- **Frontend adapter:** env-gated browser authorization-code + PKCE in
  `frontend/src/lib/auth.tsx`; no usernames/passwords and no auth SDK dependency in
  the API client. App registration platform = **Single-page application**; redirect
  URIs only `https:` in prod / `http://localhost` in dev.
- **Browser-delegated auth is REQUIRED (not native auth):** social IdPs (Google/Apple) are only
  available via browser-delegated flow — Entra's hosted sign-in page. Native auth supports local
  email+OTP/password only. So "Sign in" redirects to Entra's hosted flow; we never
  render credential fields or see passwords. [MS Learn:
  Identity providers for external tenants; Native-auth social tutorial]
- **Token cache = `sessionStorage`**; the real control against token theft is **XSS
  prevention** (strict CSP + React escaping + no `dangerouslySetInnerHTML`).
  `api.ts` injects `Authorization: Bearer` per call through `setAuthTokenProvider()`.
- **Anonymous trial UX:** subtle "1 free check" indicator; on the `trial_exhausted` 401, open a
  **sign-in sheet** (not a hard wall) explaining "free, unlimited, takes seconds."
- **Moment-of-value prompt:** sign-in is requested when the user hits Save / Share / History —
  not on landing (research-backed).
- **Account menu:** `/me` profile (email, plan=free, usage), sign-out, evidence
  consent toggle, POPIA erasure, admin queue link when the token has `admin`.
- **Degradation:** when `/health.accounts` is false (auth unconfigured), the entire sign-in UI
  is hidden and the app behaves exactly as the current anonymous flow.
- **CSP change (security):** add ONLY the exact CIAM authority origin
  (`https://<tenant>.ciamlogin.com`) to `connect-src` for silent token calls — no wildcards.
  Microsoft's own CSP enforcement is on `login.microsoftonline.com` and does not affect CIAM STS
  API calls or CIAM custom domains, so our change is scoped to our own page's policy. [MS Learn:
  CSP overview for Microsoft Entra ID]

**Sources:** [Identity providers for external tenants](https://learn.microsoft.com/entra/external-id/customers/concept-authentication-methods-customers) ·
[SPA code configuration](https://learn.microsoft.com/entra/identity-platform/scenario-spa-app-configuration) ·
[CSP overview for Microsoft Entra ID](https://learn.microsoft.com/entra/identity-platform/content-security-policy)

## 6. History / threads (Phase 5)
- Signed-in: `GET /cases` list (date, verdict chip, company) in a History view/rail;
  `GET /cases/:id` reopens a redacted case snapshot in the main workspace.
- Anonymous: browser-local History only; server history remains hidden until sign-in.

## 7. Moderator / admin (Phase 6, `requireAdmin`)
- `/admin/reports`: queue of `pending_review` community reports from
  `GET /reports/pending`. Each row: evidence summary + IOCs, actions = **approve**
  (`POST /reports/:id/moderate`) or **reject**.
- Visible only when the token carries the `admin` app-role (primary) or break-glass email.

## 8. Settings / privacy (Phase 4)
- **Consent toggle** (`PUT /me/consent`) for evidence storage — off by default; `POST /evidence`
  is blocked until on (already enforced server-side).
- **Erasure** (`DELETE /me`) with confirm — POPIA right to be forgotten.
- Plain-language privacy explainer: what we store, redaction, retention windows.

## 9. Cross-cutting frontend concerns (the parts not previously specified)
- **Error/degradation:** typed `ApiError` → operational copy; 429 → "wait Ns"; timeout →
  retry; subsystem-off → hide affordance; partial pipeline failure → show what we have +
  a "degraded" note. Top-level `ErrorBoundary` already exists; add per-card boundaries.
- **Accessibility (WCAG 2.2 AA):** keyboard-operable composer + cards; focus moves to the new
  case group on submit; `aria-live="polite"` announces pipeline status + new cards; risk states
  carry text/icon, never color alone; honor `prefers-reduced-motion`; visible focus rings;
  labelled controls.
- **Responsive / mobile:** single-column stack; composer pins to bottom with safe-area insets;
  44px touch targets; voice + camera capture on mobile.
- **Performance:** routes already `lazy`; thumbnail downscale before preview; virtualize the
  stack if a session exceeds ~30 cards; debounce paste-recognition.
- **State:** extend `store/caseStore.tsx` to a workspace model — `{ session, cards[], intent,
  attachments[], status, auth }` — one store, immutable updates, no module-level mutable leaks.
- **Copy/tone:** operational + reassuring; safety steps reviewed against `data/guidance.json`.
- **Telemetry:** optional App Insights web SDK behind the same env gate (defer to post-launch).

## 10. Backend deltas required (small, additive, env-gated)
Implemented: `/analyze`, `/me`, `/cases`, `/evidence`, consent, public `/report`
with pending-review status, `GET /reports/pending`, `POST /reports/:id/moderate`,
and `DELETE /reports/:id`.

Remaining backend backlog: richer server-side freeform report extraction, Functions
consumer/dead-letter reconciliation, and distributed rate limiting.

## 11. Phase plan

**Definition of done per phase** (gates + the `impeccable-design` review protocol):
build → preview-verify the change runs → run the `impeccable-design` review (slop-list check;
screenshot the changed screens at **1440px and 390px**; deliberately trigger the **loading /
empty / error** paths and screenshot those too — every async view ships all three designed,
never a bare spinner) → `npm run build/lint/test/eval` green → frontend `tsc` clean → commit.

Phases (each independently shippable):
- **P0 — Foundations:** workspace state model in `caseStore`; `api.ts` Bearer injection + new
  endpoints; CSP note; types. No visible change yet.
- **P1 — Workspace + Verify:** route `/`, empty state, composer (text+files+voice), live pipeline,
  card stack reusing `VerdictCard/Findings/NetworkMatches/GuidanceCitations`. Redirect old routes.
  *Demoable offline against the deterministic backend.*
- **P2 — Report mode:** segmented control + suggestion chip; ack card; freeform `/report` backend.
- **P3 — Card actions:** expand/collapse/copy/share (+`/share` link) and the save affordance.
- **P4 — Auth + account:** Entra PKCE adapter, anonymous-trial UX, `/me`, consent,
  erasure, account menu. (Implemented; live auth still requires Azure provisioning.)
- **P5 — History/threads:** `/cases` list + reopen snapshots in `/history`. (Implemented.)
- **P6 — Moderation:** `/admin/reports` + pending report endpoints. (Implemented.)
- **P7 — Polish:** per-card share, a11y/responsive/perf passes, remove dead code
  from the old two-page flow (ask before deleting anything ambiguous). Do not
  reintroduce a public Network/graph view.

## 12. Risks & mitigations
- **Auth can't be fully tested until provisioning** → build behind `health.accounts`, ship P1–P3
  first (no auth dependency), validate P4 live during provisioning.
- **Scope creep** → phases are independently shippable; cut from the end, not the middle.
- **Regression on the working deterministic flow** → keep the offline path green every phase;
  the workspace calls the same `/analyze`.
- **CSP/login origin mistakes** → scope to the exact tenant host; test the redirect before merge.
