# Handoff: PoolStatus AI — Marketing Website

## Overview
Single-page marketing website for **PoolStatus AI (PMPro 2.0)**, a field-ops telemetry + AI-protocol product for **commercial pool service technicians**. The site's job: convince a technician (or their ops manager) that the product replaces the clipboard — readings in 40s, AI protocols in 11s, inventory/equipment tracked, end-of-shift PDFs auto-generated. The design voice is a **marine/industrial telemetry console** (dark navy canvas, ALL-CAPS labels, monospace numbers, live streaming numbers). Marketing copy exists but is technical, terse, field-operator in tone.

Sections, in order:
1. Fixed top nav
2. Hero (three interchangeable variants; default is **LSI Metric**)
3. Telemetry marquee ticker strip
4. Features grid (6 cards)
5. Live Telemetry band (streaming metric tiles) — _toggleable_
6. How It Works (4-step shift loop)
7. Proof (stat cards + testimonial)
8. Pricing (3 tiers, annual/monthly toggle)
9. End-of-shift CTA + footer

## About the Design Files
The files in `design/` are **design references created in HTML+React (inline Babel)** — prototypes showing intended look and behavior, not production code to copy directly. Your task is to **recreate these designs in the target codebase's existing environment** (React, Next.js, Vue, Astro, etc.) using its established patterns, component library, and tooling. If no frontend environment exists yet, choose whatever framework best fits the project (Next.js App Router is a strong default for a marketing site) and implement the designs there.

Everything is inline in `design/index.html` — styles, components, and the App wiring — to keep the prototype portable. In production you'd split into proper components.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, interactions, and copy. Recreate pixel-perfectly, lifting exact hex values and spacing from the design tokens below.

## Design Tokens

### Colors — Canvas
| Role | Hex | Usage |
|---|---|---|
| `--color-bg` | `#060E1A` | Page background, near-black navy |
| `--color-surface` | `#0D1F38` | Cards, elevated panels |
| `--color-surface-2` | `#0A1628` | Recessed insets, inputs, alternating section bg |
| `--color-primary` | `#060E1A` | Ink on accent buttons (same as bg) |

### Colors — Accent
| Role | Hex | Usage |
|---|---|---|
| `--color-accent` | `#4FC3F7` | Primary signal color (cyan). Buttons, headlines highlight, metric values |
| `--color-accent-hover` | `#38B2F0` | Hover state of accent |
| accent-10 / 20 / 30 | `rgba(79,195,247, .10/.20/.30)` | Tinted accent fills/borders |

> **Note on tweaks:** The prototype allows switching the accent via CSS var `--acc` to `#4FC3F7` (cyan), `#10B981` (emerald), or `#F59E0B` (amber). **Ship with cyan `#4FC3F7` as the default** — it's the brand accent. The emerald the user saved is a tweakable preview, not a rebrand.

### Colors — Ink ladder
| Role | Hex | Usage |
|---|---|---|
| `--color-ink` | `#FFFFFF` | Primary foreground, headlines |
| `--color-ink-muted` | `#8AB4CC` | Body copy, secondary nav links |
| `--color-ink-dim` | `#4A6A80` | Labels, meta, low-priority text |
| `--color-border-dim` | `#1E3A5F` | Hairline separators, card borders |

### Colors — Semantic Status
| Role | Hex | Usage |
|---|---|---|
| success | `#10B981` (dot) / `#34D399` (fg) | "NOMINAL" chip |
| warning | `#F59E0B` (dot) / `#FBBF24` (fg) | "WATCH" chip |
| critical | `#EF4444` (dot) / `#F87171` (fg) | "ACTION" chip |

Each has a `-10` tint (`rgba(_,.10)`) for backgrounds and `-30` (`rgba(_,.30)`) for borders.

### Typography
- **Sans (brand):** `"Exo 2"`, variable weights 100–900. Self-hosted from `design/fonts/Exo2-VariableFont_wght.ttf` + italic. In production, host these fonts in your app. Fallbacks: `ui-sans-serif, system-ui, sans-serif`.
- **Mono (numbers/telemetry):** `"Space Mono"` 400/700 from Google Fonts. Fallbacks: `ui-monospace, SFMono-Regular, monospace`.

**Type scale (px):** xs 10 · sm 12 · base 14 · md 16 · lg 18 · xl 20 · 2xl 24 · 3xl 30 · 4xl 36.

**Weights:** light 300 · regular 400 · medium 500 · semi 600 · bold 700 · black 800.

**Tracking:** normal 0 · wide 0.04em · wider 0.08em · **widest 0.16em** · display 0.2em (used on buttons & largest all-caps labels).

**Key type roles** (from `colors_and_type.css`):
- **`.lbl` / pm-label** — `10px`, `700`, `uppercase`, letter-spacing `.2em`, color `#4A6A80`. Used everywhere for section tags, chip labels, nav links.
- **`.pm-metric` / `.mono` large** — Space Mono, `36px+`, `700`, tabular-nums, color `#4FC3F7`. Used for LSI hero value, metric tile values.
- **`h1` hero** — Exo 2, `clamp(40px, 6vw, 72px)`, weight `800`, line-height `0.95`, letter-spacing `-0.01em`, `text-transform: uppercase`, `text-wrap: balance`.
- **`h2` section** — Exo 2, `clamp(28px, 3.6vw, 44px)`, weight `800`, line-height `1`, uppercase.
- **Body** — Exo 2, `14–16px`, weight `400`, line-height `1.5–1.55`, color `#8AB4CC`, `text-wrap: pretty`.

### Spacing (4px scale)
`--space-1: 4` · `-2: 8` · `-3: 12` · `-4: 16` · `-5: 20` · `-6: 24` · `-8: 32` · `-10: 40` · `-12: 48`. Section vertical padding is **96px** top+bottom (`-12 × 2`). Hero top padding is **140px** to clear fixed nav.

### Radii
`sm 6 · md 8 · lg 12 · xl 16 · 2xl 24 · full 9999`. Cards use **12**. Buttons use **8**. The "Recommended" pricing badge uses **4**.

### Shadows
- `--shadow-sm 0 1px 2px rgba(0,0,0,.2)`
- `--shadow-md 0 4px 8px rgba(0,0,0,.3)`
- `--shadow-lg 0 10px 20px rgba(0,0,0,.4)` — default card shadow
- `--shadow-xl 0 20px 40px rgba(0,0,0,.5)`
- `--shadow-accent 0 20px 40px rgba(79,195,247,.20)` — primary button glow

### Motion
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`
- Durations: fast 150ms · base 250ms · slow 400ms
- Custom keyframes used in prototype: `tick` (fade-out 1.2s), `pulse` (opacity 1.6s loop), `scanSweep` (vertical translate 4s linear loop), `marquee` (horizontal translate 48s linear loop), `fadeUp` (mount entrance, 400ms).

### Layout
- **Container:** `max-width: 1200px; margin: 0 auto; padding: 0 24px;` (16px on mobile).
- **Grid breakpoints used:** `720px` (mobile stacks: split hero, nav links hidden), `880px` (hero grid stacks on metric hero). Use the consuming codebase's responsive primitives.

## Screens / Views

This is a single page. Each section is the "view."

---

### Nav (fixed top)
- **Height:** ~52px (14px padding top/bottom + 24px logo).
- **Initial state:** transparent background, no border.
- **Scrolled state (`window.scrollY > 12`):** background `rgba(6,14,26,.82)` + `backdrop-filter: blur(12px)` + 1px bottom border `#1E3A5F`. Transition `all .25s`.
- **Left:** Wordmark — `mark.svg` icon (`assets/mark.svg`) + text "Pool**Status**" where "Status" is accent color. Letter-spacing `.18em`, weight 800, uppercase. Base size 15px on the landing, text size scales via `size` prop.
- **Center (hidden <720px):** 5 links — `Field Ops`, `Telemetry`, `AI Protocols`, `Pricing`, `Docs`. Styled as `.lbl` (10px, tracked, `#8AB4CC`), gap 28px.
- **Right:** "Sign In" label link (hidden <720px) + small primary button with `log-in` icon and copy **"Field Access"** (8px/14px padding, 9px font).

---

### Hero — Variant A: "LSI Metric" (DEFAULT — ship this)
- **Padding:** `140px 0 80px`.
- **Background:** grid-bg pattern (48px squares, `#1E3A5F` lines @ 25% opacity) at 50% opacity + WaveBackdrop SVG at 18% opacity (two sine waves in cyan, bottom half of viewport).
- **Grid:** left column flexible, right column 420px, gap 48px. Stacks below 880px.
- **Left:**
  - Pulsing green dot + label **"LIVE · 14 UNITS ONLINE"**.
  - H1: "The pool,<br>**as a console.**" — "as a console." is accent color. `clamp(40px,6vw,72px)`, weight 800, line-height 0.95, uppercase, `text-wrap: balance`.
  - Body: "Field telemetry, LSI saturation, and AI-generated dosing protocols in the palm of your hand. Built for commercial operators working shift-based, skimmer-deep, clipboard-out." — 16px, `#8AB4CC`, max-width 480px, line-height 1.55.
  - Buttons: Primary **"Start A Reading"** with `log-in` icon. Ghost **"Watch 90-sec Demo"** with `play` icon.
  - Coords stamp at bottom: `map-pin` icon + `42.3601°N · 71.0589°W` + `UNIT POOL-07A`. Space Mono 9px, color `#4A6A80`.
- **Right — LSI card:**
  - Background `rgba(79,195,247,.04)`, border `rgba(79,195,247,.3)`, radius 12, padding 24.
  - Top 40% has a vertical scanline sweep animation (`linear-gradient(180deg, rgba(79,195,247,.12), transparent)` translated Y=-100%→100% over 4s).
  - Header row: label **"SATURATION INDEX · LSI"** + `sparkles` icon in cyan.
  - Giant LSI value — Space Mono, **88px**, weight 700, color varies by status (`#4FC3F7` ok / `#FBBF24` watch / `#F87171` action). Format with leading `+`/`-` sign and 2 decimals. Default value computed `tele.ph + 0.4 + 2.0 + 2.0 - 12.1`, jitter-updated every 1.6s.
  - Status label under value: "BALANCED" (±0.1), "SCALE FORMING" (>0.3), or "CORROSIVE" (<-0.3). Rendered with `.lbl-accent`.
  - Hairline separator, then 3-col grid: **pH** / **FC** (ppm) / **TA** (ppm). Each: tiny label + Space Mono 20px value with small unit in dim color.
  - Bottom hairline + `terminal` icon + mono line: **"AI: Dose 68g Cl · Re-test 14:00"** (10px, `#8AB4CC`).

#### Hero — Variant B: "Alert → Protocol" (split)
- Centered headline max-width 720px.
- Label row: pulsing red dot + **"INCIDENT · 07:12 · POOL-07A"**.
- H1: "From alert **to protocol**<br>in eleven seconds." — "to protocol" is accent.
- Body copy about watching chemistry, writing shift protocol, scheduling re-test.
- 3-column grid (`1fr 40px 1fr`): Alert card (red-tinted, `rgba(239,68,68,.05)` bg, `rgba(239,68,68,.3)` border) → centered `chevron-right` → AI Protocol card (cyan-tinted).
- Alert card: `alert-triangle` icon 22px red + "Free chlorine below safe threshold." + mono sub-line "FC 0.4 ppm · target 1.0–3.0 ppm / Pool classified UNSAFE. Restrict bathing." + `T+00:00` timestamp.
- AI Protocol card: 3 numbered steps in 20×20 square cyan chips — (1) "Dose 68g granular chlorine" · _Inventory: 10 kg · OK_  (2) "Run filter 8h continuous" · _Pump 72 kPa · nominal_  (3) "Re-test at 14:00" · _Auto-queued in shift plan_. `T+00:11` timestamp.
- Below grid: centered primary "Field Access" + ghost "Read The Spec".
- Collapses to single column <720px.

#### Hero — Variant C: "Dashboard Mock" (screenshot)
- Centered headline: "Shift-grade telemetry.<br>**Field-grade UI.**"
- Body + two CTAs under headline, then a **phone mock**: 340×680 device with 8px border `#1E3A5F`, 40px radius, notch bump (90×22 pill top-18 centered), drop shadow `0 40px 80px rgba(0,0,0,.6), 0 20px 40px rgba(79,195,247,.15)`.
- Inside: mini-dashboard — small wordmark + bell icon; big LSI card (+0.02, 44px mono value); 2×2 metric grid (FC/pH/TA/TEMP); full-width primary "Log Reading" button with `plus` icon.

---

### Ticker Strip
- Full-width band, `#0A1628` bg, 1px top/bottom borders `#1E3A5F`, padding `14px 0`.
- Content is 10-item array duplicated, marquee-scrolled 48s linear infinite: `FC 1.5 ppm`, `pH 7.42`, `TA 100 ppm`, `CYA 40 ppm`, `TEMP 26°C`, `PRESSURE 72 kPa`, `LSI +0.02 · BALANCED`, `FILTER 14 DAYS TO BACKWASH`, `NEXT SHIFT 16:00`, `14 UNITS ONLINE`.
- Each item: Space Mono 11px, `#8AB4CC`, tracking `.1em`, `0 24px` padding, right-border `#1E3A5F`.

---

### Features (§01 · Capabilities)
- Section header left-aligned, max 680px: `§01 · CAPABILITIES` label + H2 "Every shift,<br>accounted for." + body "Six instruments your crew actually uses. Nothing you don't."
- Grid: `auto-fit, minmax(280px, 1fr)`, 16px gap. **6 cards**, each min-height 240px, padding 24, flex-column, gap 14.
  1. `gauge` — **LSI Saturation Analysis** — "Langelier index computed live from seven chemistry inputs. Corrosive or scale-forming pools flagged before the deck etches." · meta "pH + TF + CF + AF − 12.1"
  2. `sparkles` — **AI Protocols, Not Guesses** — "Gemini-backed shift plans that weigh inventory, bather load, and filter state. With Claude and OpenAI as fall-through." · meta "Median protocol time: 11s"
  3. `package` — **Inventory That Closes The Loop** — "Dosing recommendations check stock before they fire. 'Add 68g chlorine' only if 68g exists in the cage." · meta "Min-threshold alerts built in"
  4. `wrench` — **Equipment Service Scheduler** — "Pump pressure deltas auto-queue backwash. GFCI and strainer jobs ladder into your shift calendar." · meta "Recurrence: D / W / M / 6M"
  5. `mic` — **Voice-First Field Entry** — "Read numbers aloud, wet-gloved. Speech captured, parsed, and committed without unlocking a keyboard." · meta "'Chlorine one point five'"
  6. `printer` — **End-Of-Shift Photo & PDF** — "Every shift ends with a timestamped photo of the pool deck, auto-bound to the reading and exportable for inspection." · meta "Mandatory · auditor-ready"
- Card structure: 36×36 icon tile (radius 8, `rgba(79,195,247,.08)` bg, `rgba(79,195,247,.2)` border) + "01"/"02"… index in mono top-right → title (17px, 700, uppercase, tracking `.04em`) → body (13px, `#8AB4CC`, line-height 1.55) → top hairline + meta line in Space Mono 10px `#4A6A80` tracked `.08em`.

---

### Live Telemetry (§02)
- Band with `#0A1628` bg + 1px top/bottom borders.
- Header row (space-between, align-end): left — `§02 · LIVE TELEMETRY` label + H2 "What the deck sees,<br>you see." Right — pulsing green dot + "STREAMING · 1.2s" (Space Mono 11px `#8AB4CC` tracked `.1em`).
- 6 `MetricTile` cards in `auto-fit, minmax(220px, 1fr)` grid, 12px gap. Each tile:
  - Top row: uppercase label + 60×20 sparkline (status-colored polyline at 0.65 opacity + trailing filled dot w/ halo).
  - Body: animated `Ticker` value (Space Mono, ~30px, tabular-nums) that eases between updates over 500ms, with dim unit suffix.
  - Footer row: `IDEAL {range}` label + `StatusChip` (`✓ NOMINAL` green / `⚠ WATCH` amber / `✕ ACTION` red, 9px, tracked `.2em`, tinted bg+border).
- Tile data (initial values, all jitter-updated every 1600ms):
  - **FREE CHLORINE** — 1.5 ppm — ideal 1.0–3.0 — action if <1, watch if >3
  - **PH** — 7.42 — ideal 7.2–7.6 — watch if out of range
  - **TOTAL ALKALINITY** — 100 ppm — ideal 80–120
  - **WATER TEMP** — 26.0 °C — ideal 24–30
  - **FILTER PRESSURE** — 72 kPa — ideal 55–140
  - **CYANURIC ACID** — 40 ppm — ideal 30–50
- Footer row: Coords stamp (left) + `LAST TICK · {HH:MM:SS}` (right, `toLocaleTimeString` hour12:false).

---

### How It Works (§03 · Shift Loop)
- H2: "Four steps, one shift."
- 4 equal cells in a single bordered card (1px `#1E3A5F`, radius 12, overflow hidden). Each cell: 28px padding, `#0D1F38` bg, min-height 220px, vertical dividers between.
- Cell template:
  - Big **step number** in Space Mono 36px at 30%-opacity cyan (`rgba(79,195,247,.3)`), weight 700.
  - Title — 20px, 800, uppercase, tracking `.04em`.
  - Body — 13px, `#8AB4CC`, line-height 1.55.
- Steps:
  1. **Read** — "Tap or speak the seven values. 40 seconds. Test kit, meter, or probe — doesn't matter."
  2. **Analyse** — "LSI + AI protocol generated the instant your last number hits the buffer."
  3. **Act** — "Dose from the scripted shift plan. Inventory ticks down as you go."
  4. **Commit** — "End-of-shift photo. PDF export. Signed, timestamped, auditor-ready."

---

### Proof
Two rows:

**Row 1 — stat cards** (`auto-fit, minmax(280px, 1fr)`, 16px gap, 48px bottom margin):
- `FC 1.5` — "Median free chlorine across fleet"
- `11s` — "Protocol generation time"
- `0.3%` — "Reading rejection rate after voice capture"
- `14 UNITS` — "Live across three counties"

Card: padding 24, Space Mono 32px weight 700 accent for the number, `.lbl` underneath.

**Row 2 — testimonial:** single card, 40px padding, bg `rgba(79,195,247,.03)`, border `rgba(79,195,247,.25)`. Grid `auto 1fr`, 24px gap:
- Left: 56×56 tile radius 12, bg `#1E3A5F`, centered `user` icon 24 cyan.
- Right: 20px/line-height-1.4 white quote "We stopped printing test logs. PoolStatus logs itself, signs itself, and hands the inspector a PDF before they ask. My shift starts and ends with one phone."
- Under quote: Space Mono 12px `#fff` weight 700 "M. Calderón" · 3px dim dot · `.lbl` "HEAD OPERATOR · MARINA AQUATIC CENTER".

---

### Pricing (§04)
- Centered section header: `§04 · PRICING` + H2 "Priced per unit.<br>Not per feature."
- **Billing toggle** — inline-flex pill, 4px padding, border `#1E3A5F`, bg `#0D1F38`, radius 999. Two segmented buttons: `Annual · -20%` and `Monthly`. Active: accent bg `#4FC3F7`, dark ink `#060E1A`. Inactive: transparent, `#8AB4CC`.
- 3 tier cards, `auto-fit, minmax(260px, 1fr)`, 16px gap:

| Tier | Annual/mo | Monthly/mo | Tag | Items | CTA |
|---|---|---|---|---|---|
| **Shift** | $29 | $36 | "Single operator" | 1 active unit · LSI + AI protocols · Voice capture · PDF export | "Start Trial" (ghost) |
| **Fleet** ⭐ | $89 | $109 | "Multi-site crews" | Up to 14 units · Inventory & equipment scheduler · Shift photos + auditor PDF · Team roles, RBAC · Integrations: Firebase, Gemini | "Field Access" (primary) |
| **Municipal** | Custom | Custom | "Regulated facilities" | Unlimited units · Compliance exports (EN 15288) · On-prem LLM fallback · Dedicated deployment lead · 99.9% SLA | "Talk To Ops" (ghost) |

- Card: padding 28, gap 16. Featured tier: `rgba(79,195,247,.04)` bg + `rgba(79,195,247,.4)` border + **"RECOMMENDED" badge** positioned absolutely top:-10, right:20 (accent bg, dark ink, 9px tracked, 4px radius, 4/10 padding).
- Price row: Space Mono 40px weight 700 + `.lbl` "/ unit / mo". "Custom" tier renders as 36px mono.
- Items list: top hairline, 16px padding-top, 8px gap. Each: 14px cyan `check` icon + 13px `#8AB4CC` text.
- CTA button: full-width, chevron-right suffix icon.

---

### End-of-shift CTA + Footer
- **CTA card:** padding `56px 40px`, centered text, bg = `radial-gradient(ellipse at top, rgba(79,195,247,.08), transparent 70%) #0D1F38`, border `rgba(79,195,247,.3)`. WaveBackdrop SVG overlay at 10% opacity.
  - `§ END OF SHIFT` label.
  - H2: "Put the clipboard down.<br>**Pick up the console.**" `clamp(32px, 4.4vw, 56px)`, max-width 720px.
  - Body: "Deploys on one pool, scales to a fleet. Free for your first 14 days, no card, no unit commitment." 15px, max 520px.
  - Buttons: primary "Field Access" + ghost "Book Deployment Call".
- **Footer:** 64px top margin, top hairline, 32px padding-top. Left — wordmark (13px) + Space Mono 10px `v2.0.4 · BUILD #184`. Right — 5 `.lbl` links: Docs, API, Compliance, Status, Privacy.

---

## Components (shared primitives)
Build these as reusable components in the target codebase. Names used in the prototype:

- **`Icon`** — wraps `lucide` icons. Props: `name`, `size`, `color`. Standardize on a single icon library (Lucide recommended).
- **`Label`** — `.lbl` span; optional `accent` prop for cyan.
- **`Wordmark`** — `mark.svg` + "Pool**Status**" w/ "Status" in accent. `size` prop scales text.
- **`Sparkline`** — inline SVG polyline w/ end-dot + halo. Props: `values[]`, `color`, `width`, `height`.
- **`Ticker`** — animated number; cubic-ease transition over 500ms when value changes. Props: `value`, `decimals`, `unit`.
- **`StatusChip`** — ok/watch/action; tinted bg+border, tracked caps.
- **`MetricTile`** — composes Label + Sparkline + Ticker + StatusChip into a card.
- **`WaveBackdrop`** — decorative cyan wave SVG.
- **`Coords`** — mono "location + UNIT id" stamp.
- **`Button`** — two variants: `primary` (cyan bg, dark ink, shadow-accent) and `ghost` (transparent, dim border → accent on hover). All buttons: uppercase, weight 700, tracking `.2em`, 10px font (9px for `sm`).

### Hover / focus / active states
- **Primary button:** hover `filter: brightness(1.1)`; active `transform: scale(0.97)`.
- **Ghost button:** hover `color: #fff; border-color: #4FC3F7; background: rgba(79,195,247,.05)`.
- **Nav:** scrolled state as described above.
- **Focus-visible:** `box-shadow: 0 0 0 2px rgba(79,195,247,.5)` on all buttons/links. Do not ship with `outline: none` alone.

## Interactions & Behavior

- **Fixed nav** — listens to `scroll`; toggles background/blur/border when `scrollY > 12`.
- **Live telemetry simulator** — `setInterval` 1600ms; jitters fc/ph/ta/temp/pr/cya within bounded ranges and appends to per-metric history arrays (cap 12). In production, replace with a real WebSocket/SSE feed or keep it client-only for the marketing site (it's decorative). No real backend needed for the marketing page.
- **LSI computation** — `lsi = +(ph + 0.4 + 2.0 + 2.0 - 12.1).toFixed(2)`. Status: `|lsi| > 0.3` → action, `> 0.1` → watch, else ok. Label: <-0.3 "CORROSIVE", >0.3 "SCALE FORMING", else "BALANCED".
- **Marquee ticker** — pure CSS `@keyframes marquee` translating `-50%` over 48s linear infinite. Content array duplicated for seamless loop.
- **Pricing toggle** — local state flips annual/monthly pricing; active pill styled with accent.
- **Fade-up on mount** — `@keyframes fadeUp` 400ms on hero cards; use `.anim-in` or IntersectionObserver-based reveals in production for other sections.
- **Pulse dot** — `@keyframes pulse` on 1.6s loop (opacity .55↔1).
- **Scan sweep** — vertical linear-gradient bar translated over 4s in the LSI hero card's top band.
- **Smooth scroll:** nav links currently go to `#`. Real implementation should anchor to section IDs and `scroll-behavior: smooth`.

## State Management
This is a marketing page — almost no app state is needed in production:
- `scrolled: boolean` for nav
- `annual: boolean` for pricing toggle
- Telemetry simulator state (can be removed or reduced if performance is a concern on mobile)

Ignore the prototype's `DEFAULTS` / Tweaks panel / `__edit_mode_*` postMessage plumbing — that's design-tool wiring, not a product feature. Ship with `hero: "metric"`, accent `#4FC3F7`, live-telemetry band **on**, density `comfortable`.

## Responsive Behavior
- Container 1200px max with 24px (16 on mobile) padding.
- Hero (metric) grid stacks <880px; split hero stacks <720px.
- Nav mid-links hidden <720px; consider a mobile menu (hamburger → slide-out panel) — the prototype has none.
- All grids use `auto-fit, minmax(...)` patterns; they reflow naturally.
- **Phone mock** in variant C: keep visible on mobile but cap width or it'll overflow — consider `width: min(340px, 88vw)`.

## Assets

| File | Source | Notes |
|---|---|---|
| `assets/mark.svg` | PoolMaster Pro / PoolStatus AI brand system | Used in nav wordmark and favicon |
| `assets/logo.svg` | Same | Full logo — not used on this landing currently but available |
| `fonts/Exo2-VariableFont_wght.ttf` | Google Fonts | Self-hosted variable font, 100–900 weight axis |
| `fonts/Exo2-Italic-VariableFont_wght.ttf` | Google Fonts | Italic companion |
| Lucide icons: `log-in`, `play`, `book-open`, `calendar`, `terminal`, `sparkles`, `map-pin`, `bell`, `plus`, `check`, `chevron-right`, `alert-triangle`, `gauge`, `package`, `wrench`, `mic`, `printer`, `user` | `lucide-react` (preferred in React) or `lucide` UMD | Stroke width 2 (Lucide default) |

## Copy
Full copy is in the Screens section above. Keep voice **terse, field-operator, technical**. Short lines. "Shift," "deck," "reading," "inventory," "unit," "skimmer-deep" are native vocabulary — don't soften to general B2B SaaS speak.

## Files
- `design/index.html` — the complete prototype (HTML + inline CSS + inline React via Babel). Open in a browser to see the live design.
- `design/assets/mark.svg`, `design/assets/logo.svg` — brand marks.
- `design/fonts/Exo2-*.ttf` — self-hosted Exo 2 variable fonts.
- `design/assets/ICONOGRAPHY.md` — iconography guidance from the brand system.

## Implementation Notes for Claude Code
- **Split the monolith.** In production, make each section a separate component file: `Nav`, `HeroMetric`, `TickerStrip`, `Features`, `LiveTelemetry`, `HowItWorks`, `Proof`, `Pricing`, `CtaFooter`. Put primitives (`Icon`, `Label`, `Wordmark`, `Sparkline`, `Ticker`, `StatusChip`, `MetricTile`, `Coords`) in a shared `ui/` folder.
- **Tokens first.** Drop the design tokens into your CSS layer (`@theme`/Tailwind config / CSS vars / styled-system). Don't hand-copy hex values into components.
- **Prefer Tailwind or a styled primitive.** The prototype uses inline style objects because it's a single-file prototype. In a real codebase, use your existing styling approach; don't port the inline styles verbatim.
- **Kill the edit-mode wiring.** `DEFAULTS`, `TweaksPanel`, `__edit_mode_available`, `__edit_mode_set_keys` are all design-system-only and must not ship.
- **Replace the telemetry simulator** with either a decorative hardcoded loop, a real product-API hook, or a client-only jitter that pauses when the page is not visible (`document.visibilityState`). The current 1600ms interval runs unconditionally.
- **Accessibility:** add section landmarks (`<section aria-labelledby>`), a real skip link, visible focus states (already hinted via `focus-visible`), and `prefers-reduced-motion` guards for pulse/sweep/marquee animations.
- **SEO / meta:** add open-graph, a real title ("PoolStatus AI — Telemetry for Commercial Pool Ops" is already in `<title>`), description, and JSON-LD for the SaaS product.
