# Privacy & POPIA Compliance

**Verify My Interview** processes evidence about suspected job-and-interview
scams. That evidence routinely contains personal information — of the person
asking for help, of the recruiters/companies named, and of innocent bystanders
caught in screenshots. South Africa's **Protection of Personal Information Act,
4 of 2013 (POPIA)**, enforced by the **Information Regulator**, governs how we
may do this. This document states our posture, what the code enforces today,
and what production must add.

> Status legend: **[enforced]** in code now · **[planned]** required before a
> public production launch · **[policy]** operational/legal, not code.

---

## 1. Purpose & lawful basis (POPIA s11)

The purpose is narrow and stated up front: **help a user assess whether a job
offer is fraudulent, and build shared scam intelligence to protect other job
seekers.** Personal information is processed only for that purpose (s13 purpose
specification).

Lawful bases we rely on (POPIA s11(1)):

- **s11(1)(f) — legitimate interests** of the responsible party and of third
  parties (the broader pool of job seekers). Fraud prevention is a recognised
  legitimate interest; the **Southern African Fraud Prevention Service (SAFPS)**
  operates a shared fraud database on this footing. This is our basis for
  processing a *scammer's* identifiers (email, domain, phone, payment handle)
  without their consent.
- **s11(1)(d) — protecting a legitimate interest of the data subject**: the user
  submitting evidence is protected by the analysis they requested.
- **s11(1)(a) — consent** of the submitting user, captured at upload **[planned]**
  (clear notice + affirmative action before any evidence is processed).

POPIA gives data subjects a **right to object** to legitimate-interest
processing (s11(3)). Production must provide an objection/correction channel
**[planned]** — see §6.

---

## 2. The eight conditions — how each is met

1. **Accountability (s8)** — an **Information Officer** must be registered with
   the Regulator before launch. **[policy/planned]**
2. **Processing limitation (s9–12)** — minimality: we keep only what the purpose
   needs. Scam IOCs are kept; the data subject's sensitive identifiers are
   stripped (§3). **[enforced]**
3. **Purpose specification (s13–14)** — single stated purpose; retention limited
   (§5). **[enforced in part / planned]**
4. **Further-processing limitation (s15)** — evidence is not reused for any
   purpose incompatible with fraud assessment. **[policy]**
5. **Information quality (s16)** — the system reports *evidence-backed signals*,
   never unproven conclusions; every claim cites a source (§7). **[enforced]**
6. **Openness (s17–18)** — this document plus an upload-time notice. **[planned]**
7. **Security safeguards (s19–22)** — managed-identity auth (no keys in images),
   redaction before storage/logs, TLS, breach notification (§4). **[enforced in part / planned]**
8. **Data-subject participation (s23–25)** — access / correction / deletion
   requests (§6). **[planned]**

---

## 3. Data minimization — IOCs vs sensitive identifiers **[enforced]**

The central design decision. For a fraud product the temptation is to keep
everything; POPIA s10 forbids that.

| Class | Examples | Treatment |
| --- | --- | --- |
| **Scam indicators (IOCs)** | recruiter email, domain, phone, payment handle, wallet, URL | **Kept** — these *are* the evidence; processing them is the s11(1)(f) purpose. Stored in dedicated structured fields. |
| **Sensitive identifiers** | SA ID number, bank-account number, payment-card number | **Stripped** before any free text is logged or stored — never needed to detect or attribute a scam. |
| **Bystander personal info** | faces, names of non-scammers in a screenshot | **Not collected as structured data**; production should blur/redact on ingest. **[planned]** |

Enforcement lives in [`src/backend/privacy/redaction.ts`](../src/backend/privacy/redaction.ts):

- `redactSensitiveIdentifiers()` — storage/display filter. Masks SA ID numbers
  (13-digit, contiguous or spaced), payment-card numbers, and account-context
  bank numbers. Applied to the report `description` at
  [`POST /report`](../src/backend/server.ts) before it is indexed or graphed.
- `maskForLogs()` — stricter log filter. Also masks email local-parts (keeps the
  domain for IOC triage) and phone digits (keeps last two). Logs must never
  carry recoverable personal information.

The raw evidence-bearing **images are deliberately NOT in this repository.** The
detection logic and synthetic test fixtures were derived from real screenshots
held privately offline; the committed fixtures contain only **synthetic**
names, emails, phones, and domains.

---

## 4. Security safeguards (s19)

- **Authentication** — Foundry/Azure access via **Microsoft Entra managed
  identity / `DefaultAzureCredential`**; no API keys baked into images or git.
  `.env` and build output are git-ignored. **[enforced]**
- **In transit** — TLS terminated at the platform ingress. **[enforced by host]**
- **Redaction at boundaries** — see §3. **[enforced]**
- **Secrets** — for production, move Document Intelligence / Search keys into
  **Azure Key Vault** and prefer keyless (managed-identity) connections where
  the service supports it. **[planned]**
- **Breach notification (s22)** — a documented process to notify the Regulator
  and affected data subjects "as soon as reasonably possible" after a
  compromise. **[policy/planned]**

---

## 5. Retention (s14) **[planned]**

POPIA: do not keep records longer than necessary for the purpose.

- **Submitted evidence** (raw text/upload): process, then discard — do not
  persist raw evidence beyond the request unless the user explicitly reports it
  to the network. Target: ephemeral.
- **Network reports** (redacted IOCs + redacted description): retained while
  useful for fraud prevention; subject to periodic review and the objection
  process. Define a concrete review interval (e.g. annual re-validation) before
  launch.
- **Logs/telemetry**: redacted at write time (§3); apply a short retention
  window in Log Analytics / Application Insights.

---

## 6. Data-subject rights (s23–25, s11(3)) **[planned]**

Before public launch, provide a channel to: confirm what is held, request
correction or deletion, and **object** to legitimate-interest processing. A
named entity who believes they were wrongly listed must be able to contest it —
this is both a POPIA right and the mitigation for the defamation risk in §7.

---

## 7. Special personal information & the "showcasing proof" risk (s26)

POPIA s26 prohibits processing **special personal information** unless an
exception (s27–s33) applies. Two categories are unavoidable here:

- **Criminal behaviour / alleged offences (s26(b))** — labelling an actor as a
  likely scammer *is* processing information about alleged criminal conduct.
  s33 permits this for bodies processing such information within their lawful
  remit, and s27 permits it where necessary for the establishment of a right in
  law. Our guardrail: **report evidence-backed risk signals, never a verdict of
  guilt.** Risk language is "signals indicate", "consistent with known scam
  patterns" — not "this person is a criminal".
- **Biometric information (s26)** — faces in uploaded screenshots and ID
  documents are biometric/sensitive. We do not extract or store faces; ID
  numbers are redacted (§3). Production should blur faces on ingest. **[planned]**

**Defamation discipline.** Because the product collects and may surface proof
about named parties, every public-facing claim must be (a) evidence-cited,
(b) framed as a risk signal not a conviction, and (c) contestable (§6). The eval
suite enforces the *don't-over-flag* half of this with legitimate-control cases
(a real recruiter on an unusual TLD; a normal learnership) that must **not** be
flagged — see `tests/test_cases/sa_legit_*.json`.

---

## 8. Cross-border processing (s72) **[planned]**

POPIA s72 restricts transferring personal information outside South Africa
unless the recipient is subject to comparable protection, the data subject
consents, or it is necessary for the purpose. The current Azure resources are in
**East US / East US 2** (a hackathon convenience). For a production SA service,
deploy to **Azure South Africa North (Johannesburg)** and document the s72 basis
for any processing that remains cross-border. (Note: some Content Safety
features such as groundedness detection are region-limited — verify regional
availability when choosing the deployment region.)

---

## 9. Quick compliance checklist (pre-launch)

- [ ] Register an Information Officer with the Information Regulator (s55/s56).
- [ ] Upload-time notice + consent; publish this policy (s17–18).
- [ ] Objection / correction / deletion channel (s23–25, s11(3)).
- [ ] Retention schedule implemented and automated (s14).
- [ ] Face blurring on ingest; ID/bank/card redaction (already enforced) (s26, s10).
- [ ] Move to Azure South Africa North or document s72 basis.
- [ ] Secrets in Key Vault; breach-response runbook (s19, s22).
- [ ] Keep raw evidence images out of source control (enforced here).

---

## References

- POPIA full text — [justice.gov.za](https://www.justice.gov.za/legislation/acts/2013-004.pdf) ·
  [SAFLII](https://www.saflii.org/za/legis/consol_act/popia4o2013399/)
- POPIA s11 lawful basis — [popia.co.za/section-11](https://popia.co.za/section-11-consent-justification-and-objection/)
- Information Regulator (South Africa) — [inforegulator.org.za](https://inforegulator.org.za/)
- Southern African Fraud Prevention Service (POPIA-aligned shared fraud data) — [safps.org.za](https://www.safps.org.za/)
