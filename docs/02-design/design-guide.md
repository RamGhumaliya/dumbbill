# Design Guide – Dumbbill

Goal: it must look **designed by a human product designer**, not generated. The product is used for 8+ hours a day by cashiers and owners, so clarity and speed beat decoration.

## 0. DECISION (16 Oct 2026): Dark = Direction A, Light = Direction B, one brand
Interactive preview: `directions/index.html`. Both themes are token sets over the same components.

| Token role | Dark (Iron Ledger) | Light (Quiet Ledger) |
|---|---|---|
| bg.base / surface / side | `#0E0F11` / `#16181B` / `#121316` | `#FBFAF8` / `#FFFFFF` / `#F4F2ED` |
| border / strong rule | `#2A2D31` / `#ECEAE4` | `#E3DFD6` / `#CFCABE` |
| text / muted | `#ECEAE4` / `#8D9096` | `#1B1F23` / `#5F646A` (darkened from `#6B7075` in P0-4: the old value measured 4.4:1 on the side panel, below the 4.5:1 minimum) |
| accent (primary action, totals focus) | volt `#C6F432` on-accent `#0E0F11` | deep teal `#0F5C5C` on-accent `#FFFFFF` |
| highlight / tag | `#C6F432` on `#2A2D31` | amber `#E8A33D` (tag bg `#FDF0D9`, text `#8A5A10`) |
| success / danger | `#4DDC8E` / `#FF6A45` | `#1D7A4F` / `#B4402B` |

**Unified (same in both themes):** type = Inter Tight (UI), Barlow Condensed (totals, KPI numerals, headings), JetBrains Mono (SKUs, barcodes, prices in tables); radius 4 px controls / 8 px cards; table header has the 2 px strong rule; 4 px spacing grid; same motion. Quiet Ledger's serif is **not** used, so the two themes cannot drift into two brands.
Rules: components reference semantic tokens only; verify contrast of every pairing (volt on dark and teal on light both ≥ 4.5:1 for text); never use volt on a light surface. Theme switch: `data-theme="dark|light"` on web, `ThemeExtension` on Flutter; default follows system, POS remembers per terminal.

## 1. Original three directions (kept for reference)

### Direction A – "Iron Ledger" (bold fitness-retail)
- Feel: gym-floor energy, confident, dense but legible.
- Base: ink `#0E0F11`, surface `#16181B`, line `#2A2D31`, paper (light mode) `#F4F2EC`.
- Accent: **volt** `#C6F432` on dark / `#5A7A00` on light; alert `#FF5A36`; success `#2FBF71`.
- Type: display **Barlow Condensed / Oswald (700)** for numbers & headers; UI **Inter Tight**; mono **JetBrains Mono** for SKUs/prices.
- Signature: oversized tabular numerals for totals, hard 2px dividers, sharp 4px radius, no soft shadows.

### Direction B – "Quiet Ledger" (trustworthy, fintech-calm)
- Base: warm white `#FBFAF8`, ink `#1B1F23`, slate scale; one brand colour **deep teal** `#0F5C5C`, highlight `#E8A33D`.
- Type: **Söhne-like → use "Instrument Sans"** for UI, **"Newsreader"** for report headlines, tabular figures on.
- Signature: generous whitespace, hairline borders, restrained colour, charts in two hues max.

### Direction C – "Corner Shop" (warm, local)
- Base: cream `#FFF7EA`, cocoa `#3B2A20`, accent **tomato** `#E2492F`, secondary **leaf** `#3C7A4B`.
- Type: **"Bricolage Grotesque"** headings, **"DM Sans"** body, rounded 10–14px radii, hand-drawn-style empty-state illustrations (commissioned/illustrated, not stock).
- Signature: friendly copy, stickers/stamps for badges ("In stock", "Expires soon").

Deliverable before Phase 1 UI work: a Figma file (Figma MCP available) with colour/type/spacing variables, components, and the 6 hero screens (POS, dashboard, products, purchase entry, customer app home, shop QR poster) in the chosen direction.

## 2. The Anti-"AI look" rulebook (enforced in code review)
**Never do:**
1. Purple→blue/pink gradients, glassmorphism, glowing blobs, "aurora" backgrounds.
2. Generic hero: centered headline + gradient subtext + two pill buttons.
3. Three-identical-cards-with-icons grids as the default layout; emoji as icons; icon in a tinted rounded square for every bullet.
4. Overuse of rounded-2xl, drop shadows on everything, pastel badges everywhere.
5. Lorem ipsum, "John Doe", "Acme Inc", "Revolutionize/Elevate/Seamless/Unlock" copy, em-dash-heavy marketing voice.
6. Default Tailwind/shadcn look untouched: every component must pass through our tokens (radius, border, type, density).
7. Stock-photo smiling people, 3D blob illustrations, random Unsplash.
8. Perfectly symmetric, evenly spaced everything with no hierarchy.

**Always do:**
1. Start from **real data & real tasks**: use realistic seed data (Optimum Nutrition Gold Standard 2 lb, MuscleBlaze Raw Whey, expiry dates, ₹ amounts with Indian grouping `₹1,24,500`).
2. Establish **hierarchy through scale and weight**, not colour; pick one dominant element per screen.
3. Use a **4 px spacing grid**, an 8-step type scale, and at most 2 radii. Document in tokens.
4. Tabular numerals for money, right-aligned. Show ₹ with correct grouping, negative values in a defined style.
5. **Dense where experts work (POS, tables), airy where people decide (onboarding, offers).**
6. Specific, plain microcopy: "Bill saved. Print receipt?" not "Awesome! You're all set 🎉". Errors say what happened and what to do.
7. Purposeful asymmetry and one memorable signature element per direction.
8. Custom empty states, custom iconography (single icon set, one stroke weight: Phosphor/Lucide customised), custom illustrations.
9. Imperfection by design: mixed column widths, real table alignment, uneven rhythm where content demands.
10. Review each screen with the **"Squint + Swap" test**: blur it (hierarchy still clear?) and swap the logo for a competitor's (still ours?).

## 3. Foundations (token spec)
- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64.
- **Type scale (px):** 11 / 12 / 14 / 16 / 20 / 28 / 40 / 64; line-height 1.2 headings, 1.5 body; POS totals 48–64 tabular.
- **Radius:** 4 (controls) and 8 (cards/modals) only (Direction C: 10/16).
- **Elevation:** max 2 levels; prefer borders over shadows.
- **Colour:** semantic tokens (`bg.surface`, `text.muted`, `status.danger`) – components never use raw hex. Contrast ≥ 4.5:1 text, 3:1 UI. Light & dark.
- **Density:** Comfortable (mobile/customer), Compact (tables/POS, 32 px rows).
- **Iconography:** 1.5 px stroke, 20 px grid.
- **Imagery:** real product packshots on neutral background; consistent crop; fallback placeholder by category.

## 4. Key screens & layout notes
| Screen | Notes |
|---|---|
| **POS** | Full-bleed, no sidebar. Left 62%: search + cart table. Right 38%: totals (huge), discount, customer chip, Pay. Persistent shortcut legend (`F2` search, `F4` discount, `F9` pay, `Esc` cancel). Touch targets ≥ 48 px. High contrast for bright counters. Offline pill top-right. |
| **Owner dashboard** | Today strip (sales, bills, profit), branch comparison, alert rail. No decorative charts; every chart answers a question. |
| **Products table** | Inline edit, sticky header, column picker, bulk actions, keyboard nav. Cost column hidden without permission (not blurred). |
| **Purchase entry** | Spreadsheet-like grid with tab navigation, batch/expiry columns, live WAC preview. |
| **Customer app home** | Shop cards w/ points, membership QR sheet (brightness boost), offers feed. |
| **Super Admin** | Plain, utilitarian, table-first. |

## 5. Motion & animation
Principles: motion explains change; never blocks work; honours `prefers-reduced-motion`.
| Token | Value |
|---|---|
| Durations | micro 100 ms, base 180 ms, large 280 ms, page 360 ms max |
| Easing | enter `cubic-bezier(.2,.8,.2,1)`, exit `cubic-bezier(.4,0,1,1)`, spring only for QR sheet / drag |
| **POS** | Item add: row slides 8 px + 120 ms highlight; totals tick-count 180 ms; **no** animation on keystroke paths > 150 ms |
| Lists | Stagger ≤ 30 ms × 8 items; skeletons not spinners |
| Success | Checkmark stroke-draw 240 ms on invoice saved + subtle haptic on mobile |
| Charts | Draw-in 400 ms once on mount only |
| Page | Shared-element transition for product → detail on web (View Transitions API), Hero on Flutter |
Tech: CSS transitions/View Transitions first; Motion (framer-motion) only where needed; Flutter implicit animations + `Rive`/`Lottie` only for empty states. Animate transform/opacity only. 60 fps budget; no layout thrash.

## 6. Accessibility
WCAG 2.2 AA; visible focus ring (2 px, offset 2); logical tab order; ARIA only when native fails; screen-reader labels for scanner and totals (live region announces total changes politely); min 44 px targets on touch; no colour-only status; zoom to 200% without loss; Flutter `Semantics` on all interactive widgets.

## 7. Content & voice
Plain, brief, Indian-English, respectful. Numbers over adjectives. Labels use nouns ("Purchase cost"), buttons use verbs ("Save purchase"). All strings in i18n files (`en.json`/ARB) with keys, no concatenation.

## 8. Design QA checklist (per screen)
Tokens only • states: default/hover/focus/active/disabled/loading/empty/error • light/dark • 360 px to 1920 px • long names/Indian numerals/`₹99,99,999` • RTL not required • reduced motion • keyboard path • real data • passes Squint+Swap.
