---
name: impeccable-design
description: Design-quality bar for every UI change — adapted from pbakaus/impeccable (anti-AI-slop detector rules) and fused with this repo's Sentinel design system. Use WITH sentinel-ui whenever creating or reviewing anything in frontend/ — sentinel-ui says WHAT our system is; this skill says HOW to keep it impeccable. Also use when reviewing screenshots of the UI (Playwright/Preview/Chrome tools) before demo recording.
---

# Impeccable Design (adapted for Verify My Interview)

Source: [pbakaus/impeccable](https://github.com/pbakaus/impeccable) — distilled
here and fitted to the Sentinel dark security-SaaS system. For the full pack
(23 commands, 41 deterministic detectors) install via
`npx impeccable skills install` — but THIS file is the binding house version.

## The slop list — never ship these

1. **Default typefaces as identity.** No Arial/system-default-as-brand. We use
   the Sentinel stack (see `sentinel-ui`); body text never below 12px/0.75rem.
2. **Pure black / pure gray.** Always tint toward the ink scale (`ink-*`
   tokens). Pure `#000`/`#888` reads dead on a dark security UI.
3. **Gray text on colored surfaces.** On `accent`/status chips use the
   designed foreground token, not `text-muted`.
4. **Purple→blue gradients, dark glows, glassmorphism halos.** Instant AI-slop
   tells. Sentinel uses flat surfaces + 1px borders + restrained accent.
5. **Card-inside-card-inside-card.** Max 2 levels of surface nesting
   (`surface` → `surface-2`). Need a third? Redesign the hierarchy.
6. **Bounce/elastic easing.** Motion is `ease-out`, 120–250ms, purposeful
   (enter/exit/state change) — never decorative loops on dashboards.
7. **Emoji as iconography.** lucide-react only, 1.5px stroke, consistent size.
8. **Unstyled states.** Every async view ships loading + empty + error states,
   designed (not browser defaults, not bare spinners centered in void).

## The positive bar — every screen must have

- **One clear hierarchy:** a screen answers ONE question first (here: "how
  risky is this job offer?"); everything else is secondary by size/contrast.
- **Density with rhythm:** security-SaaS density (CrowdStrike/Stripe Radar),
  consistent 4px-grid spacing; no airy marketing voids, no cramped tables.
- **Evidence-first affordances:** numbers and verdicts always sit next to
  their proof (signal → evidence source chip). Never a bare score.
- **Accessibility floor:** visible focus rings, aria-labels on icon-only
  buttons, 4.5:1 contrast for text, keyboard-reachable interactive elements,
  `prefers-reduced-motion` respected for nonessential animation.
- **Error empathy:** failures say what happened and what to do next, in the
  product's calm voice ("Transcription isn't configured on this server —
  paste the message instead"), never raw error strings.

## Review protocol (run before any frontend work is "done")

1. Re-read the diff against the slop list — each hit is a blocker, fix it.
2. Screenshot the changed screens (Claude Preview / Playwright / Chrome MCP)
   at 1440px and 390px; check hierarchy, spacing rhythm, contrast, states.
3. Trigger the loading/empty/error paths deliberately (devtools throttle,
   missing key) and screenshot those too.
4. Verdict in the report: pass, or numbered findings with file:line.
