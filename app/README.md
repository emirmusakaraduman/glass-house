# GlassHouse web

Next.js frontend for GlassHouse: home and car loans on Solana that anyone can audit.
Earn in USDC, borrow in USDC; every loan is public, no one's identity is, and the platform's
own capital takes the first loss.

## Run it

```bash
cd app
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000
```

`npm run dev` and `npm run build` first run `scripts/listing-images.ts`, which lists the photos in
`public/listings/` (see İlan Bulucu below).

## Checks

Run all four before every merge; they must pass with no errors or warnings.

```bash
npm run typecheck      # tsc --noEmit
npm run check:finance  # installment, max price, IRR and stress numbers vs. the design doc
npm run check:mock     # invest → apply → fund → repay → crank → recovery, plus wallet balances
npm run build
```

## Pages

The app has two layouts: the landing page with a top nav and footer, and the app screens with a
sidebar (a bottom tab bar on phones), a top bar with the page title, and the wallet card.

| Route | What it shows |
| --- | --- |
| `/` | Hero, what's different, the home pool's live loss order, latest loans, how a loan moves, both pools side by side |
| `/finder` | İlan Bulucu: the most you can pay from income and savings (computed in the browser), listings under it, search, filters and sorting |
| `/apply` | Three-step application (details, financing, review and sign) with a live loan summary, total cost card and amortization table |
| `/invest` | Investor dashboard: KPIs, pool growth chart, portfolio split, both pools with an invest dialog, your position and the withdrawal line |
| `/transparency` | Every loan in the open: KPIs, the 3D loss stack, pool health, overdue loans anyone can flag, every loan, LTV distribution |
| `/loans/[id]` | One loan: status path, payments and countdown, pay and flag, next signature by role, public vs. off-chain data, history |
| `/stress` | Sliders for price drop, defaults and sale cost; GlassHouse vs. a 2008-style lender; sale-cost sensitivity |

Every action (deposit, withdraw, apply, approve, fund, confirm title, repay, flag, recovery) reports
its result in a toast. In mock mode it says "Mock transaction"; on devnet it links to Solana Explorer.

## Mock and chain

Every screen talks to one interface, `GlassHouseClient` in `src/lib/chain/client.ts`, through
`useChainQuery` and `useAction` (`src/components/providers/ClientProvider.tsx`).

**Mock (today, `NEXT_PUBLIC_DATA_SOURCE=mock`).** An in-memory client with 10 home loans and 3 car
loans, simulated on-time borrowers, and the same rules as the program: LTV on min(price, appraisal),
10% cash buffer, lending brake, payment order, time-derived crank, loss order. One "month" is
60 seconds and the grace period is 10 seconds, like the devnet demo. Every wallet (the demo wallet,
or one you connect) starts with 250,000 test USDC; deposits, applications and repayments come out of
it, withdrawals and refunds go back in. State lives in memory: a full page reload starts over, and
"Reset demo data" does the same on purpose. Signatures are fake, so no Explorer links are shown.

**Chain (once the IDL lands).**

1. Copy `target/idl/glasshouse.json` to `public/idl/glasshouse.json`.
2. Set `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_USDC_MINT`, `NEXT_PUBLIC_DATA_SOURCE=chain` and
   `NEXT_PUBLIC_SITE_URL` (for absolute OpenGraph links).
3. Implement `GlassHouseClient` in `src/lib/chain/anchor.ts` (PDA seeds, micro-USDC and status helpers
   are already there), including `getWalletBalance` from the owner's USDC token account, and create it
   in `ClientProvider.tsx` instead of the mock.

The screens don't change.

## Deploy (Netlify)

1. New site from the GitHub repository. **Base directory: `app`.** Build settings come from
   [`netlify.toml`](netlify.toml) (`npm run build`, publish `.next`, Node 22). Netlify adds its
   Next.js runtime by itself; no plugin to install.
2. Add the environment variables below under Site configuration → Environment variables.
   `NEXT_PUBLIC_*` values are baked into the build, so redeploy after changing any of them.
3. Deploy, then set `NEXT_PUBLIC_SITE_URL` to the site's address and deploy once more.

The addresses are public devnet accounts from `deployments/devnet.json`.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | `chain` (or `mock` for in-memory demo data) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `devnet` |
| `NEXT_PUBLIC_RPC_URL` | `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_PROGRAM_ID` | `HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2` |
| `NEXT_PUBLIC_USDC_MINT` | `8KPWZb15PSYmW7vpE66dSGxNGaEQ21JXGSd7QmwLxPuW` |
| `NEXT_PUBLIC_HOUSE_POOL` | `3rbdkVxXQfZmXMWn1dVXZ5hPE2ToWrvA5USH4EwsxZPz` |
| `NEXT_PUBLIC_VEHICLE_POOL` | `Ef1qTy79zdLTSxNaTm5Bb4Lb82SyoqnWREDu6JDVzu6m` |
| `NEXT_PUBLIC_SITE_URL` | the site's own address, e.g. `https://<site>.netlify.app` |
| `FIRECRAWL_API_KEY` | secret, set in Netlify only; never in the repo |
| `FIRECRAWL_HOUSE_URLS` | `https://www.panamaequity.com/property-city/panama-city/` (robots.txt and terms checked; first page only) |
| `FIRECRAWL_VEHICLE_URLS` | empty: Automarket is allowed but takes ~18 s, past the 8 s budget; cars stay on sample data |
| `FIRECRAWL_LIVE` | `on` |
| `FIRECRAWL_LIVE_CITIES` | `Panama City` |
| `FIRECRAWL_TIMEOUT_MS` | `8000` (Netlify functions stop at 10 s; after this the finder shows sample data) |

`NEXT_PUBLIC_RPC_URL` is sent to every browser, so never put an RPC URL that contains an API key
there. With both Firecrawl URL lists empty the finder never calls Firecrawl and always shows
**Sample data**.

## İlan Bulucu (Firecrawl) and privacy

- `GET /api/listings?type=house|vehicle&city=…&maxPrice=…` in `src/app/api/listings/route.ts`.
- **Income and savings never leave the browser.** Only the asset type, city and price range reach
  the server and Firecrawl. Search, filters and sorting run on the results already in the browser.
  The chosen listing goes to the application through `sessionStorage`, never the URL; only its salted
  hash and value band are meant for the chain.
- Live calls use Firecrawl's `/v2/scrape` with a JSON schema (`src/lib/listings/firecrawl.ts`).
  Sources are URL templates in `FIRECRAWL_HOUSE_URLS` / `FIRECRAWL_VEHICLE_URLS`; add only sites
  whose robots.txt and terms allow it. The API key stays on the server. One cache entry per city and
  asset type lasts 15 minutes (a new budget filters it), and each source host gets at most one
  Firecrawl request every 10 seconds; when the host was just asked, the route answers from the cache
  or sample data. Live listings show no photos and link back to the source page; nothing scraped is
  written to the repo.
- If live is off, slow or empty, the route falls back to `src/data/listings.seed.json` and the UI
  labels it **Sample data**. The seed is hand-made example data. When live results exist but none is
  under the budget, the response carries `aboveBudget` (the three closest) and `samples`.
- Listing photos: `imageUrl` from the source, else `public/listings/{id}.webp` if it exists
  (run `npm run listings:images` after adding files), else a drawn placeholder.
- Comparable-listings signal: a listing more than 15% above the median of similar listings
  (same district per m² for homes, same make/model ±1 year for cars) shows a warning. It never sets
  the value; the underwriter's signed appraisal does.
- On loan pages only pseudonymous data is shown: `GH-0001` ids (`GH-V0001` for car loans), city-level region, value bands and
  salted hashes. Names, addresses, income and documents stay off-chain.

## Accessibility

Text on the dark background meets WCAG AA, focus is always visible, every icon-only control has a
label, charts have text summaries, dialogs keep focus inside and close with Esc, and
`prefers-reduced-motion` turns off every animation (page fade, hero entrance, 3D stack sway,
tilt, chips). Pages are checked at 390, 768, 1024, 1440 and 1920 px.

## Screenshots

`npm run demo:screenshots` walks the demo story (doc: "Demo senaryosu") in one browser session and
saves 1920×1080 PNGs to `../docs/screenshots/`. Start a production server first:

```bash
npm run build && npm run start -- -p 3123
npm run demo:screenshots    # BASE_URL=http://localhost:3123 by default
```

| File | Step |
| --- | --- |
| `00-landing.png` | Landing page |
| `01-finder-maria.png`, `02-finder-listings.png` | Maria's budget: $100,531 limit, Panama City homes (sample data) |
| `03-apply-details.png`, `04-apply-financing.png`, `05-apply-review.png` | The three application steps |
| `06-application-sent.png` | Application sent |
| `07-loan-pending.png`, `08-loan-in-escrow.png`, `09-loan-active.png` | Approve → fund into escrow → title confirmed |
| `10-installment-paid.png`, `11-invest-dashboard.png` | First installment; share price and chart on the dashboard |
| `12-gh0006-late2.png`, `13-gh0006-defaulted.png` | A stranger's check moves GH-0006 to Late-2, then Defaulted |
| `14-transparency-loss-stack.png` | The first-loss slab absorbs the provision; investors untouched |
| `15-stress-doc-scenario.png`, `16-stress-40-percent.png` | GlassHouse vs. 2008-style lender at 30% and 40% drops |

Screenshots use mock data and reduced motion.

## Stack

Next.js 16 (App Router), React 19, Tailwind CSS v4, Solana wallet adapter (Wallet Standard
discovery), Recharts, lucide-react. Plus Jakarta Sans is the only typeface. Playwright is a dev-only
tool for the screenshot script.
