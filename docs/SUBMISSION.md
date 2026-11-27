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

It is a prototype on devnet with mock USDC. We have no licensed lender or SPV partner yet, deposits
are not KYC-gated, and the code has not been independently audited; see the README's "Known
limits".

## How we used Firecrawl

**[CONFIRM: describe only what is actually built and working. The text below is the v4 design.]**

The listing finder (frontend, server side) turns a borrower's budget into a maximum price with a
rule-based calculation, then uses Firecrawl to fetch real house or vehicle listings below that
price from selected Panama listing sites. Only the property type, city and price range are sent to
Firecrawl; income and savings stay in the browser. Choosing a listing pre-fills the `apply_loan`
form with its price. The listing URL is never written on-chain; only a salted hash and a value
band are. Queries are cached for 15 minutes, and a labelled sample data set ("EXAMPLE DATA") is
used if a live call fails, so the demo never depends on live scraping.

## Links

- Repository: https://github.com/emirmusakaraduman/glass-house
- Demo video (under 3 minutes): **[CONFIRM]**
- Live app: **[CONFIRM]**
- License: MIT
