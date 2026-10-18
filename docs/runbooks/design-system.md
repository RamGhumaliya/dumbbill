# Design System (tokens, components, how to change them)

The look of Dumbbill lives in three layers. Change the lowest layer that does the job.

```
docs/02-design/tokens/tokens.json   colours, type, shape, motion   (single source of truth, shared with the mobile app)
        |  pnpm tokens  (in dumbbill-web)
        v
src/styles/*.css  +  src/lib/design/token-names.ts      GENERATED, never edited by hand
        |
        v
src/components/ui/*      the components (Button, Input, Select, Table, Dialog ...). Screens are built only from these.
        |
        v
src/app/**               screens
```

Live gallery of everything: run the web app and open **http://localhost:3001/design** (development only; the page does not exist on the live site). Use the Dark / Light switch to compare the two themes.

## The decisions (from the design guide, section 0)

| | Dark | Light |
|---|---|---|
| Name | Iron Ledger | Quiet Ledger |
| Base / surface | `#0E0F11` / `#16181B` | `#FBFAF8` / `#FFFFFF` |
| Accent (the one thing to look at) | volt `#C6F432` | deep teal `#0F5C5C` |

One type system for both: **Inter Tight** (interface), **Barlow Condensed** (totals, headings), **JetBrains Mono** (prices in tables, SKUs). Two corner radii only (4 and 8 px), no shadows, a hard 2 px rule under table headers.

## Common jobs

### Change a colour
1. Edit the value in `docs/02-design/tokens/tokens.json` (both themes if needed).
2. `pnpm tokens` in `dumbbill-web`. It refuses to write anything if a pair becomes too faint to read (WCAG contrast), and tells you which one.
3. Open `/design` in both themes and look. Run `pnpm test`.

Never type a colour in code. The lint rule and tests reject `#ff0000`, `bg-[#fff]` and `w-[13px]`.

### Add a colour role (rare)
Add it under `color.roles` (give it a Tailwind name and a one-line purpose), give it a value in **both** themes, and add the contrast pairs it appears in. A role with no contrast check, or a value missing in one theme, fails the tests.

### Add or change a component
1. Put it in `src/components/ui/<name>.tsx` and export it from `index.ts`.
2. Use only token classes (`bg-surface`, `text-muted`, `rounded-card`, `text-small`, `min-h-(--size-control-md)`). Build on Radix when the component is interactive (menus, dialogs, tabs ...): it provides keyboard and screen-reader behaviour that is very easy to get wrong by hand.
3. Handle every state: default, hover, keyboard focus, active, disabled, loading, invalid, empty, error.
4. Show it in `src/components/design/gallery.tsx`.
5. Add browser tests in `tests/e2e/design-system.spec.ts` for its keyboard behaviour; the accessibility scan of the gallery covers it automatically in both themes.
6. Write the doc comment: what it is for, how to use it, what it guarantees.

### Change fonts
`pnpm add -D @fontsource...`, edit `scripts/copy-fonts.mjs`, run `pnpm fonts`, update `src/app/layout.tsx` and the font names in `tokens.json`, run `pnpm tokens`. Commit the font files (they are self-hosted: the app never contacts Google).

**Rupee sign:** only Inter Tight contains the rupee symbol. Barlow Condensed and JetBrains Mono do not, so their stacks fall back to Inter Tight for it (set in the token generator). If you change a font, check it has U+20B9, or keep a fallback that does.

## The review checklist (what "human-designed" means here)

Run on every new screen or component, in both themes:

1. **Squint:** blur the screen (the gallery tests save blurred screenshots to `test-results/screens/`). Can you still tell what matters most? One dominant element per screen.
2. **Swap:** put a competitor's logo on it. Would it still look like ours? Condensed uppercase headings, hard rules, the accent colour used sparingly and a dense layout are the signature.
3. **Real data:** realistic Indian retail content (`₹1,24,500.00`, real product names, expiry dates), never lorem ipsum.
4. **Not template-looking:** no gradients, glass, shadows, emoji icons, identical icon-card grids, pastel pill badges everywhere (the anti-AI-look rulebook in the design guide).
5. **States:** loading, empty, error, disabled and focus all designed, not defaults.
6. **Keyboard:** reachable and operable without a mouse, focus visible, focus returns where it came from.
7. **Words:** plain, specific and short. Errors say what is wrong and what to do.

## Automatic guards (all in `pnpm test` and `pnpm test:e2e`)

| Guard | Fails when |
|---|---|
| Token validation | a colour pair is below its contrast minimum in either theme, a role is missing in a theme, a new role has no contrast check |
| Generated files up to date | someone edited `tokens.json` without running `pnpm tokens`, or hand-edited a generated file |
| Lint: raw colours / pixel sizes | TypeScript uses `#hex`, `[13px]` or `12px` outside the tokens |
| CSS scan | a hand-written CSS file contains a hex colour or a pixel value |
| Axe accessibility | the gallery (default state, and with a dialog, a select and a popover open) has a serious accessibility problem in either theme |
| Component behaviour | keyboard use of buttons, fields, select, checkbox, tabs, table sorting, dialog (focus trap and return), popover, toast |
| Reduced motion | animations are not instant for people who ask for reduced motion |
| Self-hosted assets | any font or style is requested from another website |

## Figma
The Figma connector was not signed in during P0-5, so the JSON file is the source of truth. When Figma is connected, create its variables from `tokens.json` (colour roles per theme, type scale, radius, motion) so the file and the code stay identical; never the other way round.

## Mobile
The Flutter apps generate their Dart theme from the same `tokens.json`: `cd dumbbill-mobile && dart run tool/generate_tokens.dart`. The script runs the same 54 contrast checks as the web and writes `lib/core/theme/design_tokens.generated.dart` (committed; a test fails if it is stale, `--check` verifies it). Dark and light are two `ThemeExtension` instances (`DumbbillColors`), so widgets read colours through the theme and never use raw values. Fonts are the same families as the web, converted to TTF by `tool/convert_fonts.py`; only Inter Tight has the rupee sign, so the numeral and code styles fall back to it. After changing `tokens.json`, run the generator for BOTH apps (`pnpm tokens` in web).
