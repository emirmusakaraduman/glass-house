# Submission form draft (Dev3pack Global)

Draft text for the hackathon form. Items marked **[CONFIRM]** depend on facts this repo cannot
prove (deployment, frontend, the other two team members' work). Fill them before sending;
do not submit claims that are not true on the day.

Deadline: 29 November 2026 (time is announced on the hackathon panel).

## Project name

GlassHouse

## One sentence

Transparent home and vehicle loans on Solana for borrowers who earn in USDC: every loan is public
under a pseudonym, the rules live in code, and the platform's own capital takes the first loss.

## Category

DeFi

## Program address (Solana devnet)

`HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2`

Deployed and executable on devnet. On 27 November 2026 the on-chain binary was compared with the
local build and matched (SHA-256 `2172fb29…5571`). Re-check with `solana program show <id> --url devnet`
before submitting; deploy steps are in [DEPLOY.md](DEPLOY.md).

Other addresses (mock USDC mint, pools, vaults): [`deployments/devnet.json`](../deployments/devnet.json)
(filled by the deploy scripts; the demo seed created 13 loans).

## Description

*(The first two sentences are the polished pitch; the rest is supporting detail.)*

GlassHouse is a Solana credit protocol that lets people who earn in USDC borrow against a home or
a vehicle, funded by verified investors, with every loan's performance visible on-chain and no
personal data on-chain. Rules that usually live in a bank's back office, such as the minimum down
payment, the loan-to-value cap, the liquidity buffer, the lending brakes and the order in which
losses are absorbed, are enforced by the program, and the platform's own first-loss vault takes
losses before investors do.

Two isolated pools (house at 70% LTV, 7% fixed, 240 months; vehicle at 60% LTV, 9% fixed,
60 months) run from one Anchor program. A borrower and a seller sign together; the down payment,
a 1% fee and three instalments of collateral sit in escrow until a title agent confirms
registration, and `fund_loan` is permissionless because every condition is checked on-chain.
Investor share value is computed from internal counters rather than token balances, so donating to
a vault cannot move the price. Our own security review found and fixed two denial-of-service
issues before deployment, and the program is covered by 51 Rust unit tests and 206 integration tests (143 LiteSVM, 63 on a local
validator), including house and vehicle end-to-end flows, loss-waterfall recovery and a pool-isolation test.
The devnet pools are seeded with 13 demo loans in different states, and a verification script checks the on-chain
program hash, pool invariants and a short write round against them.

It is a prototype on devnet with mock USDC. We have no licensed lender or SPV partner yet, deposits
are not KYC-gated, and the code has not been independently audited; see the README's "Known
limits".

## How we used Firecrawl

The listing finder turns a borrower's income and savings into a maximum price with a rule-based
calculation that runs in the browser. Only the asset type, city and price range go to our server
route (`/api/listings`); income and savings never leave the browser. Choosing a listing pre-fills
the `apply_loan` form with its price, and the listing URL is never written on-chain: only a salted
hash goes on-chain.

For homes in Panama City the route calls Firecrawl's scrape endpoint on one page of Panama Equity
(panamaequity.com/property-city/panama-city/), with a JSON schema for listings and a prompt that
forbids inventing any. We checked the site first: its robots.txt allows that page and the listing
pages and asks for a 10-second crawl delay, and it publishes no terms of use (the privacy policy
has nothing against automated access). The route keeps only items whose link really appears on the
scraped page, drops rentals, and reads Panama price formats such as "$ 95,000", "B/. 95.000" and
"US$95k" (covered by `npm run check:prices`).

Access stays light: only the first page, at most one Firecrawl request to a site every 10 seconds,
and one 15-minute cache entry per city and asset type, so a different budget filters the cached page
instead of asking the site again. Live cards show no photos (they belong to the site); they show
title, price, area, bedrooms, "Live from panamaequity.com" with the fetch time, and a link back to
the listing. When nothing live is under the budget, the finder says so, shows the three closest live
listings above it with Apply turned off, and keeps the sample listings in their own labeled section.
Scraped listings stay in server memory only; none are written to the repository. If Firecrawl fails
or takes more than 8 seconds, the finder falls back to sample data. The API key stays on the server.

Cars stay on sample data. Automarket's site allows it, but its stock page took about 18 seconds to
scrape, more than our 8-second budget under Netlify's 10-second limit. We don't use Encuentra24 or
Compreoalquile, whose terms forbid automated access (Encuentra24 section 11; Compreoalquile section
1.5.1), or Champion Motors, whose terms forbid automated extraction for republishing.

## Links

- Repository: https://github.com/emirmusakaraduman/glass-house
- Demo video (under 3 minutes): **[CONFIRM]**
- Live app: https://glasshouse0.netlify.app
- License: MIT
