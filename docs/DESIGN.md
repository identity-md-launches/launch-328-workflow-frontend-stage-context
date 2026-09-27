# Lease design

## Overview

Lease is a compact Sepolia rental market for people minting, listing and borrowing Lease Keys. The implemented page combines a warm off-white canvas, dark forest surfaces, lime action emphasis, serif headings and a practical data table. The mint panel introduces ownership; the marketplace places per-key actions next to contract state. The visual direction was inferred for this assignment.

Source of truth: [`web/src/tokens.css`](../web/src/tokens.css), [`web/src/styles.css`](../web/src/styles.css), and [`web/src/App.tsx`](../web/src/App.tsx). This document is under `docs/` because the task's higher-priority path allowlist forbids a root `DESIGN.md`.

## Colors

The implementation uses one light theme and hex CSS properties, without remote assets or unused theme variants.

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#f5f4ef` | Page canvas |
| `--color-surface` | `#fffefa` | Table, fields, focus separation |
| `--color-inset` | `#eeeee6` | Editor and table header |
| `--color-text` | `#242b25` | Main text |
| `--color-muted` | `#62685d` | Supporting text |
| `--color-border` | `#d9dbd0` | Structural separators |
| `--color-control-border` | `#858e80` | Interactive control boundaries |
| `--color-forest` | `#21382c` | Mint surface, filled buttons |
| `--color-on-forest` | `#f5f4ef` | Text on forest |
| `--color-on-forest-muted` | `#c2cdbf` | Secondary text on forest |
| `--color-forest-line` | `#5a7360` | Decorative key rings |
| `--color-forest-disabled` | `#3c5142` | Unavailable mint control |
| `--color-lime` | `#d7ed92` | Enabled mint and key illustration |
| `--color-selected` | `#e8efdc` | Selected row and transaction notice |
| `--color-disabled-bg` | `#e6e8de` | Unavailable controls |
| `--color-disabled-text` | `#6b7166` | Disabled control text |
| `--color-error`, `--color-error-bg` | `#8b3028`, `#faeae4` | Recoverable errors |
| `--color-warning`, `--color-warning-bg` | `#745017`, `#f5ecd6` | Network and eligibility explanations |
| `--color-focus` | `#8b530b` | Focus perimeter, with light separation ring |
| `--color-link-hover` | `#416342` | Link hover |

Status always includes text. Contrast evidence is recorded for actual computed foreground/background pairs in [`evidence/contrast.json`](evidence/contrast.json); disabled controls are not treated as active text. The focus perimeter has a 3px surface-colored separation ring so it also stands out against the dark mint card.

## Typography

- `--font-body`: Arial, Helvetica, sans-serif. Body copy is 1rem, line height 1.55. Most controls are 0.875rem; dense table text and captions have a 0.75rem floor. Body and caption weights start at 400; label emphasis is 550–650. These are system fonts, so the actual face/available weights depend on the visitor's OS.
- `--font-display`: Georgia, Times New Roman, serif. The hero uses `clamp(2.8rem, 5.2vw, 5rem)`, line height 1.12 and letter spacing −0.055em. Section h2 is 2.25rem, falling to 1.8rem on small screens. Mint h2 is 1.875rem; editor h3 is 1.6rem. Informational h3 is 1.4rem.
- `--font-mono`: SFMono-Regular, Consolas, monospace, used for addresses and technical deployment fields. Changing balances, prices, counts and dates use tabular numerals.
- Labels are stored in natural case; `.eyebrow` applies uppercase and 0.115em tracking. Headings use balanced wrapping; supporting paragraphs use `text-wrap: pretty`. Intro copy has a 27rem maximum measure, and information paragraphs use character-based limits.
- Inputs remain 1rem (16px at the default root) on mobile. Addresses are abbreviated in the table with full accessible names, titles and explorer destinations; full contract and wallet addresses appear in deployment details. Amounts wrap without rounding away precision. No webfonts are downloaded.

## Layout

`.shell` provides a centered 1440px maximum width and fluid inline padding `clamp(1rem, 4.4vw, 4rem)`. Alignment follows the shared shell edge. Spacing predominantly uses 0.5, 0.75, 1, 1.5, 2 and 3rem steps. Group separation is larger than internal field gaps.

The hero is a `minmax(0, 1.6fr)` / `minmax(0, 1fr)` grid. Its card header and the site header can wrap under text enlargement. The wallet strip has four sections, with balances permitted to wrap. The market uses a flexible table and a 300px editor, aligned at the top. The editor is in normal flow and never overlays the table.

At 70rem and below, the editor moves below the table, the wallet explanation occupies its own row and a visible horizontal-scroll hint appears. At 42rem and below, the hero and informational sections stack, the network/wallet controls group vertically, the market heading shrinks and footer content wraps. Row controls grow to a 44px minimum touch target.

The table retains native table semantics and confines horizontal overflow to a focusable labeled `.table-scroll` region. The key number itself is the selection control, so it is available before horizontal scrolling. Selecting a key brings the editor into view and focuses it. The table has 25 IDs per page; pagination stays below it. These behaviors were checked at 1440, 768, 390 and 320 CSS pixels and with 200% root text sizing at 768px. Native browser zoom and physical-device rendering were not tested.

## Elevation & Depth

The page is deliberately flat. Background tones and thin borders separate the table, editor, fields and notices. There are no floating modals, backdrop blurs or decorative shadows. The only box shadow is the high-contrast focus separation ring; it is a state indicator, not surface elevation. The skip link uses stacking level 5 when focused.

## Shapes

`--radius-panel: 12px` is used for the mint card, table and editor. `--radius-control: 8px` is used for fields, notices and main buttons. Small row controls use 6px corners. Small step numbers have circular outlines. `KeyArt` and `KeyIcon` are local inline SVGs with inherited colors; they have no raster or network dependency. Decorative SVGs are hidden from assistive technology.

## Components

The application is a single-page component; these are source patterns, not a separately published component library.

| Pattern | Source | States and reuse |
| --- | --- | --- |
| `.button` | `styles.css`, `App.tsx` | Neutral default; `primary`/`solid` forest; `mint-button` lime; `quiet` surface; `compact` pagination. Native disabled state, focus, hover, press. |
| `KeyArt`, `KeyIcon` | `App.tsx` | Decorative hero artwork and compact key selection icon. Use SVG instead of font-dependent key glyphs. |
| `AddressLink` | `App.tsx` | Short visible address, full accessible name and explorer link from runtime configuration. |
| `.wallet-strip` | `App.tsx` | Minted supply, wallet balance and rental allowance. Unknown values are em dashes, never invented zeros. |
| `.table-panel` | `App.tsx` | Native scoped column/row headings, selected row, empty collection, loading and paginated read states. Active user and price come from contract views. |
| `.editor` | `App.tsx` | Empty instructions, owner listing form or renter approval/rent steps. Labelled inputs, inline field errors, focused invalid fields. Advanced transfer/access controls use native disclosure. |
| `.notice` | `App.tsx` | Error, warning and transaction variants. Errors use a stable alert region; progress uses a stable polite status region. Hash links survive confirmation failures. |
| `.deployment` | `App.tsx` | Native disclosure for full contract/pool details, public RPCs, faucets and allowance revocation. |

Transactions are disabled when wallet, chain, deployment checks, fresh reads, eligibility or approval prerequisites fail. Mint and rent controls explain why they are unavailable. State labels remain present independently of color. Form validation is performed at submission where contract prerequisites do not already disable an action.

Motion is limited to 120ms interruptible filter/scale transitions and scale 0.96 on press, under `prefers-reduced-motion: no-preference`. There are no entrance, autoplay or looping animations. Forced-colors mode uses a system Highlight outline. Focus uses 3px indicators, and the first keyboard stop is a skip link.

## Do's and Don'ts

- Start an additional surface inside `.shell`, reuse the existing text roles and keep its controls in document order.
- Use semantic color properties and native buttons, fields, tables and disclosures. Keep long IDs and exact token amounts reachable.
- Place eligibility explanations next to disabled actions. Preserve the exact reviewed rental maximum across asynchronous refreshes.
- Keep public chain settings in the runtime deployment manifest. Do not add a second compiled address or ABI map.
- Keep a new page or section compatible with relative static URLs and the narrow-screen table behavior. Avoid adding fixed-width content that defeats the `minmax(0, …)` grids.
- Preserve calm error messages and clear verb-led actions. Do not represent a contract revert as a wallet rejection.

Design guidance: [Jakub Krehel's Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: [Paul Bakaus's Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. This document describes implemented source and recorded checks; it is not an independent accessibility certification.
