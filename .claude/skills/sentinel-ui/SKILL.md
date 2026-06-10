---
name: sentinel-ui
description: The Sentinel design system for Verify My Interview's frontend — tokens, component recipes, motion conventions, and hard rules. Use whenever creating or modifying anything in frontend/ (pages, components, styles) so every screen converges on one professional dark security-SaaS look (CrowdStrike Falcon / Stripe Radar density, NOT a generic AI chatbot).
---

# Sentinel Design System

Verify My Interview must look like a fraud-intelligence operations platform, not a hackathon chatbot. The system is **already implemented** in `frontend/tailwind.config.js` and `frontend/src/index.css` — extend it, never fork it.

## Hard rules

1. **No emojis. Anywhere.** Use `lucide-react` icons (already a dependency) at 14–18px, `strokeWidth={1.75}`.
2. **One accent color** (`accent` = `#4d7cfe`). Risk states use the `risk.*` palette only. Never introduce new hues.
3. No glassmorphism, no decorative gradients, no "AI is thinking..." copy. Status copy is operational: "Running domain verification", "4 tools called".
4. Density over whitespace: 13–14px body in data areas, `font-mono` for identifiers (domains, emails, hashes, report IDs, scores).
5. Headings: `font-display` (Space Grotesk, loaded in `index.html`). Body: `font-sans` (Inter). Identifiers/labels: `font-mono` (JetBrains Mono).

## Tokens (defined in `tailwind.config.js` — use these classes)

| Token | Value | Use |
|---|---|---|
| `bg-ink-950/900` | `#080a10` / `#0a0c12` | Page background |
| `bg-ink-850` | `#0f121a` | Card surfaces |
| `bg-ink-800/750/700` | lighter inks | Nested surfaces, inputs, hover rows |
| `border-line` | `#232a39` | All borders |
| `text-slate-100` | — | Primary text |
| `text-muted` / `text-faint` | `#8a93a6` / `#5a6377` | Secondary / tertiary text |
| `accent` (+`-hover`, `-soft`) | `#4d7cfe` | Interactive, links, primary buttons, active states |
| `risk-low` | `#2fbf71` | Low Risk, positive signals |
| `risk-needs` | `#e0a93b` | Needs Verification |
| `risk-suspicious` | `#e0783b` | Suspicious |
| `risk-scam` | `#f0544f` | Likely Scam, red flags |
| `risk-inconclusive` | `#8a93a6` | Inconclusive |
| `shadow-card` / `shadow-glow` | — | Cards / primary CTA + active accent elements |

## Component recipes (classes in `index.css` — reuse)

- **Card:** `<div className="surface p-5">` (rounded-2xl, line border, ink-850, shadow-card). Nested: `surface-2`.
- **Buttons:** `btn-primary` (accent, glow) / `btn-ghost` (outlined ink).
- **Section label:** `<p className="eyebrow">Intelligence Network</p>` (mono, uppercase, tracked).
- **Badge:** `inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-800 px-2 py-0.5 font-mono text-[11px]` + risk color text. Engine badges: `foundry` → text-accent, `deterministic` → text-muted.
- **Stat tile:** surface-2 with `eyebrow` label + `font-display text-2xl` value + optional `font-mono text-xs text-faint` delta.
- **Table:** full-width, `text-[13px]`; header row `eyebrow` + `border-b border-line`; body rows `border-b border-line/50 hover:bg-ink-800/60`; identifier cells `font-mono`.
- **Status dot:** `h-1.5 w-1.5 rounded-full` + risk/accent bg color, paired with mono label.

## Graph styling (EvidenceGraph / react-force-graph-2d)

Canvas background transparent over `bg-ink-900`. Node fill by type:
`report` `#4d7cfe` · `domain` `#e0783b` · `email` `#e0a93b` · `phone` `#f0544f` · `payment_handle` `#f0544f` · `company` `#8a93a6` · `recruiter_alias` `#c084fc`.
Node radius `4 + Math.min(reportCount, 6)`. Trust ring: `corroborated`/`trusted` nodes get a 1.5px outer ring in `#f0544f`/`#4d7cfe`. Links `rgba(138,147,166,0.25)`, width by `weight`. Labels: 10px JetBrains Mono `#8a93a6`, drawn in `nodeCanvasObject`.

## Motion (Framer Motion)

- Reveal: `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}`.
- Stagger lists/stages with `delay: i * 0.08` (timeline replay uses real `duration_ms` proportions, capped ~350ms/stage).
- Never animate color or layout on data refresh; only opacity/transform. No springs bouncier than `damping: 24`.

## Page anatomy

Every page: `Layout.tsx` shell (top nav: logo / New Case / Network), `max-w-6xl mx-auto px-6`, an `eyebrow` + `font-display` h1 header block, then content grid. Report page is a 2-column grid (`lg:grid-cols-[1fr_380px]`): report left, chat rail right.
