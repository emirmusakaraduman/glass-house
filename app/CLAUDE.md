# GlassHouse web: rules for every task

Frontend for GlassHouse (Dev3pack Global Hackathon, 27–29 Nov 2026). Next.js 16 App Router,
React 19, Tailwind CSS v4, Solana wallet adapter, Recharts. Runs on mock data until the
Anchor IDL lands. Product source of truth: `../docs/GlassHouse_v4.pdf`.

## Visual target

- `../docs/design/mockup.png` is a layout reference only: its colors (purple) are no longer the
  target, its text is Turkish and its numbers are made up (see below).
- Palette (tokens in `src/app/globals.css`; use tokens and classes, never hard-coded colors):
  - Background `#0B1120` (`frost`). Glass surfaces `#131C31` at about 70% with backdrop blur
    (`pane`, `surface`, `night` for solid), 1px white/10 edge, edge turns `#00D2FF`/40 on hover.
  - Cyan accent `#00D2FF` (`accent`, also `steel` for links/edges): icons, active tabs and menu items,
    links, focus ring, glows, the main chart series, gradient headlines (`#00D2FF` to `#E0F7FF`).
  - Gold `#F59E0B` (`gold`, hover `#FBBF24`): ONLY the one main action button per screen
    (`Button` default variant = `btn-gold`, navy `#0B1120` text, never white) and at most one key
    figure per page (the finder's "most you can pay"). Gold is never used in charts. Other strong
    actions use `variant="accent"`; secondary ones `quiet` (glass with a cyan edge). The wallet
    button is quiet, not gold.
  - Text: primary `#F1F5F9` (`ink`), secondary `rgb(203 213 225 / 0.7)` (`muted`).
  - Status: ok `#34D399`; warn `#FB923C` (orange) and every warn badge or note carries an
    `AlertTriangle` icon; bad `#F43F5E` for borders, fills, dots and the loss hatch, with red text in
    `bad-fg` `#FB7185` (plain `#F43F5E` text is only 4.2:1 on its own tint; this exception to the
    palette is approved).
  - Charts: home pool `#00D2FF`, car pool `#818CF8` (`indigo`), consistently in every chart and legend
    (`CHART.home`, `CHART.car` in `src/components/chartTheme.ts`).
- Glassmorphism cards, soft cyan glow, background glows in cyan and deep blue only.
- Older task prompts may say 'violet' or 'purple'. Read that as the cyan accent (#00D2FF); if it refers
  to the main action button, read it as gold (#F59E0B).

## Copy

- All UI text is in English (global jury, English demo video).
- No Turkey, Istanbul, Turkish city or TL on any screen, listing or sample. The market is dollarized
  economies (Panama City, Guayaquil). Reason: PDF section "Neden Türkiye borçlu pazarı değil"
  (FX loans to individuals are banned in Turkey).
- 7.37% is the borrower's fee-inclusive effective annual cost, not an investor return. Always shown with
  "Not a legal APR" (or equivalent) next to it.
- Investor side says "target yield, gross ~6% (home) / ~8% (car)". Never use the word "APY".
- 35% is the installment / free-income limit (max DTI). It is not a "holder rate" or anything else.
- "Investors lose nothing" only when the computed investor loss is exactly 0. As a general claim use
  "the loss reaches investors last".
- Keep the phrases "Not a legal APR", "licensed partner", "designed to reduce". Don't harden legal claims
  ("compliant", "the chain enforces").

## Numbers

- Never take a number from the mockup. Its $400,000, 20% down, 36 months, $11,892, $12.5M, 243 loans,
  "7.37% APY", "35% holder rate", $24.7M, 1,248 loans, 987 borrowers, 7,250 USDC etc. are placeholders.
- Every number comes from `src/lib` (`finance.ts`, `pools.ts`, `stress.ts`) or from `GlassHouseClient` data.
- Don't change logic in `src/lib` without asking first. `npm run check:finance` pins it to the PDF.

## Data access

- Screens read and write only through `GlassHouseClient`, via `useChainQuery` / `useAction`
  (`src/components/providers/ClientProvider.tsx`). No direct mock imports or fetches in screens
  (the `/api/listings` route is the one off-chain exception, used by İlan Bulucu).
- `src/data/listings.seed.json` is always shown with a visible "Sample data" label, never as live listings.
- Income and savings never go to the server or into a URL. The hand-off stays in `sessionStorage`
  (`src/lib/selection.ts`).

## Privacy on screen

- No personal data. Loan id in `GH-0001` format for home loans and `GH-V0001` for car loans
  (`loanLabel`; numbering is per pool, so the `V` keeps the two apart), region at city level only,
  value band (house 50k, car 5k) instead of the exact value where the chain would show it.
- In mock mode (`DATA_SOURCE === "mock"` or signatures starting with `mock-`) never show an
  Explorer link: the signatures are fake.

## Dependencies

- Ask before adding any dependency. Pre-approved: `lucide-react`.
- Playwright (or any test/browser tool) also needs a yes first.

## Accessibility

- Text contrast on the dark background meets WCAG AA (4.5:1 body, 3:1 large text and UI edges).
- Visible keyboard focus on every interactive element.
- `prefers-reduced-motion: reduce` turns off animations and transitions (glow pulses, chart animation).
- No horizontal overflow at 390px width.

## Definition of done (every task)

```bash
npm run typecheck
npm run check:finance
npm run check:mock
npm run build
```

Then open every changed page at 1440px and 390px, take screenshots and review them yourself
(contrast, overflow, focus, labels, no mockup numbers, no Turkey references).
