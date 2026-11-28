# GlassHouse

**Transparent home and vehicle loans on Solana, for borrowers who earn in USDC.**

GlassHouse matches USDC earners in dollarized economies with verified investors. Every loan is
visible on-chain under a pseudonym, the rules live in code, and the platform's own capital takes
the first loss. Two isolated pools (house, vehicle) run from a single Anchor program.

- Hackathon: Dev3pack Global, 27–29 November 2026. Network: Solana **devnet**. Token: **mock USDC**.
- License: MIT (see [LICENSE](LICENSE)). Legal notes: [docs/LEGAL.md](docs/LEGAL.md).
- Program ID: `HLKhCx1dFCCH3oTaaQEBEXZ5PShftueTFTEmKVZFyrP2`
- **Status:** prototype. Not audited. Do not use with real funds.

- Repository: https://github.com/emirmusakaraduman/glass-house
- Devnet deployment: the program is deployed and executable on devnet, and the on-chain binary is
  byte-identical to the local build (SHA-256 `2172fb29…5571`, checked 27 November 2026 after the
  interest-fix upgrade). The mock USDC mint, both pools (house, vehicle) and their vault,
  first-loss, reserve, share-mint and treasury accounts exist on-chain; addresses are in
  [`deployments/devnet.json`](deployments/devnet.json). The pools are seeded with 13 demo loans
  (house: 6 Active, 1 PaidOff, 2 Late1, 1 Defaulted; vehicle: 3 Active) by `scripts/seed.ts`, and
  `scripts/verify-devnet.ts --execute` passes against them.
  Deploy steps: [docs/DEPLOY.md](docs/DEPLOY.md).
- Demo video: **[TODO: link]**
- Live frontend: https://glasshouse0.netlify.app

## The idea in four sentences

1. Income, loan and repayment are in the same currency. No FX mismatch.
2. Each loan is public on-chain under a pseudonym, and the rules are code: at least 30% down for a
   house and 40% for a vehicle, fixed rate, no leverage, isolated pools. The platform absorbs the
   first loss.
3. Investors earn USD interest backed by a house or a vehicle. Borrowers get credit against USD
   income that local banks do not recognise.
4. The platform charges a small origination and service fee. Long term, the business is
   infrastructure for licensed lenders (B2B).

## How it works

```
 borrower + seller sign            underwriter              anyone              title agent
 apply_loan ───────────▶ Pending ──approve_loan──▶ Approved ──fund_loan──▶ Funded ──confirm_title──▶ Active
   (down payment + 1% fee            │ Reject                  (permissionless)    │ deadline passed
    + 3 instalments collateral        ▼                                            ▼
    into escrow)                   Rejected (full refund)                       Cancelled (cancel_funding,
                                                                                 anyone; full refund)
 Active ─▶ Late1 ─▶ Late2 ─▶ (Active | Defaulted ─▶ Recovered),  Active ─▶ PaidOff   (teammate scope)
```

1. **Pool setup.** The platform creates a pool with `create_pool` and seeds the first-loss vault
   (`fund_first_loss`). Investors `deposit` USDC and receive pool shares.
2. **Application.** The borrower and the seller **both sign** `apply_loan` (and must differ).
   Down payment, a 1% origination fee and three instalments of collateral go into two separate
   escrows. The loan starts `Pending`.
3. **Approval.** The underwriter calls `approve_loan` with `Approve` or `Reject` (one instruction).
   Approve records the appraisal, salted document hashes, a city-level region code and a value
   band, and requires `principal <= max_ltv * min(price, appraised_value)`. Reject refunds the
   borrower in full and closes the escrows.
4. **Funding.** `fund_loan` is **permissionless**: every condition is checked on-chain and money
   only moves from the pool vault into that loan's escrow, so the caller needs no authority.
5. **Title.** The title agent calls `confirm_title` before the deadline: the seller is paid, half
   of the fee goes to the reserve and half to the platform treasury, and the loan becomes `Active`.
   If the deadline passes, anyone can call `cancel_funding`: the principal returns to the vault and
   the borrower gets the down payment, fee and collateral back.

### Pool parameters (fixed by `scripts/create-pools.ts`)

| | House | Vehicle |
|---|---|---|
| Max LTV | 70% | 60% |
| Rate (fixed) | 7% | 9% |
| Term | 240 months | 60 months |
| Recovery coefficient | 0.63 | 0.54 |
| Interest split | 6% pool / 0.5% platform / 0.5% reserve | 8% / 0.5% / 0.5% |

A third configuration, `crisis2008` (LTV 97%, no first-loss requirement, reserve brake off), exists
so the stress simulation can run on-chain. The program only validates **safety bounds**; product
values live in the script.

Reference numbers (locked in tests): house, 70,000 at 7% for 240 months → instalment **542.71**,
first-month interest 408.33, cash at closing 30,000 + 700 fee + 1,628 collateral = **32,328**.
Vehicle, 12,000 at 9% for 60 months → instalment **249.10**, first-month interest 90.00,
cash at closing 8,000 + 120 + 747 = **8,867**.

## Architecture

One program, nine account kinds. All token accounts are PDAs; the pool PDA is their authority.

| Account | Seeds |
|---|---|
| Pool | `["pool", admin, pool_id]` |
| Vault | `["vault", pool]` |
| FirstLossVault | `["first_loss", pool]` |
| Reserve | `["reserve", pool]` |
| ShareMint | `["shares", pool]` (mint authority = pool) |
| WithdrawRequest | `["wreq", pool, seq]` (teammate scope) |
| Loan | `["loan", pool, next_loan_id]` (id comes from the pool counter, not the borrower) |
| LoanEscrow | `["escrow", loan]` |
| CollateralEscrow | `["collateral", loan]` |

```
programs/glasshouse/src/
  state.rs        Pool, Loan, enums (frozen interface, see docs/STATE.md)
  math.rs         fixed-point interest, U256 mul_div, instalment, splits
  nav.rs          NAV, share price, invariants
  errors.rs  events.rs  constants.rs  u256.rs
  instructions/   create_pool  fund_first_loss  deposit  apply_loan
                  approve_loan  fund_loan  confirm_title (+ cancel_funding)
tests/            *.test.ts (LiteSVM, run with `npm test`)
tests/localnet/   glasshouse.ts  smoke_house.ts  smoke_vehicle.ts  crisis_2008.ts  (`npm run test:localnet`)
scripts/          create-mock-usdc  create-wallets  create-pools  export-idl  seed  verify-devnet
docs/             STATE.md  DEPLOY.md  LEGAL.md
```

### Math and units

USDC has 6 decimals; all amounts are micro-USDC (`u64`), rates are bps, time is seconds (`i64`).
Fixed point is 1e18 in `u128`, every operation is checked, and every product of two scaled numbers
goes through a U256 `mul_div`. `(1+r)^n` uses square-and-multiply; the instalment is
`M = P·r·x/(x−1)` with `x = (1+r)^n`. Rounding favours the protocol: amounts taken from the
borrower round up, amounts paid out round down, and interest-split remainders go to investors.
`create_pool` also computes an instalment at the bounds to prove nothing overflows.

### NAV and shares

```
senior_nav  = idle_cash + total_outstanding − max(0, loss_provision − first_loss − reserve)
share_price = senior_nav / total_shares
```

NAV is computed from internal counters, **never from the vault balance**, so donating tokens to a
vault cannot move the share price. Shares are minted with a virtual offset against first-depositor
attacks. A small entry/exit fee (0.2%, an assumption) softens the known NAV jump at payment time.

### Loss order

Borrower collateral → proceeds from selling the asset → (stretch) underwriter stake →
**first-loss vault (at least 5% of outstanding principal)** → reserve → senior investors.

## Design decisions

These were chosen during implementation and can be changed; if one changes, update this section.

1. **Reserve brake at 0.25%, not 1%.** The 0.5% fee half from the first loan already covers it
   twice, so the first loan is not blocked. Funded-but-untitled loans are tracked in
   `reserve_pending`; `fund_loan` adds to it, `confirm_title` moves it to `reserve_balance`,
   `cancel_funding` removes it. The brake reads `reserve_balance + reserve_pending`; NAV reads
   `reserve_balance` only.
2. **Parameter bounds are a safety range, not product values.** Examples: `max_ltv ≤ 97%`,
   `rate 1..=2000 bps`, `term 1..=360`, `provision` non-decreasing, `grace < period`. Parameters
   are immutable after `create_pool`.
3. **U256 intermediates** (`uint` crate) for every scaled product; results return through
   `try_from` and fail with `MathOverflow`.
4. **A low appraisal rejects the loan; it does not shrink it.** The LTV check uses
   `min(price, appraised_value)`.
5. **`approve_loan` carries both decisions** (`Approve | Reject`); no separate reject instruction.
6. **`fund_loan` is permissionless**, and the 5% first-loss rule is part of it.
7. **Escrow and share-supply invariants are `>=` / `<=`, not `==`** (found in our own security
   review). Anyone can send tokens to an escrow account, and a holder can burn their own shares;
   equality checks would let one micro-USDC lock a loan, or one burned share block every deposit.
   Refund and cancel paths pay out the real balance, so a donation simply goes to the borrower.
8. **Provision order is `[Active, Late1, Late2, Defaulted floor]`** = `[0, 500, 1500, 1500]` bps.
9. **"Reserve 0" means `brake_reserve_bps = 0`.** Only the `crisis2008` pool turns the reserve brake
   off (new loans keep flowing even when the reserve is empty); house and vehicle use 25 bps.
10. **Exact price and appraised value are public; approved loans do not expire.** The loan stores
    price, principal and `appraised_value` numerically so the LTV check is verifiable on-chain;
    identity, address, listing URL, VIN/plate and deed numbers are never written. The program has
    no approval timestamp, so an `Approved` loan can be funded later with an old appraisal. We
    accepted this as a known limit rather than change the program before the feature freeze.

## Security

Every instruction ends with accounting invariants (`vault >= idle_cash`, escrow covers loan
counters, share supply ≤ counter). Role checks use `has_one` (underwriter, title agent, admin),
token accounts are pinned by mint, owner and authority, PDAs by seed and bump, and cross-pool
account substitution is rejected (tested). A self-review fixed two denial-of-service issues
(escrow donation, share burn) before deployment. **This is not an independent audit.**

## Running the tests

Requirements: Rust, Solana CLI **4.4.1** (Agave), Anchor 0.32.1, Node 24, npm. On Windows, build and
test inside WSL2. The program is built as **SBPF v0** (`--arch v0`, required by LiteSVM 0.8).

```bash
npm ci
npm run build              # program (SBPF v0) + IDL
cargo test --lib           # 51 Rust unit tests (math, nav, parameter bounds, lifecycle, waterfall)
npm test                   # 143 LiteSVM tests (pools, deposits, loan flow, repay, payoff, crank, recovery, withdrawals, invariants, authority, stress simulation)
npm run test:localnet      # 63 integration tests on a local validator (pools, loan lifecycle, stress of rules)
```

All three suites pass against the same merged binary. Coverage: pool creation and every parameter
bound, first-loss and deposit (donation attack), the whole loan lifecycle, repayment, lateness and
default handling, recovery with the loss waterfall, the withdrawal queue, house and vehicle
end-to-end with the reference numbers above, pool isolation, and the 2008-mode pool.

## Deploying to devnet

See [docs/DEPLOY.md](docs/DEPLOY.md). Scripts default to a dry run and only write to the chain with
`--execute`. Secret keys are generated into `.keys/` (git-ignored) and never published.

## Where the code came from

- **Written before the hackathon start (on 26 November 2026, the day before 27 November):** the
  Anchor program core: `state`, `math`, `nav`, the eight instructions listed above, their tests,
  and the deploy scripts. **[TODO: team to confirm and list anything else that existed earlier,
  such as libraries, design documents and the v1–v4 plans.]**
- **Backend B (repayment, withdrawals, crank, recovery, tests, simulation):** `repay`, `payoff`,
  `request_withdraw`, `process_withdrawals`, `crank_loan`, `record_recovery`, the provision tiers and
  loss order, the LiteSVM test suite (143 tests), the 100-loan stress simulation (27 scenarios) and
  the demo seed script. **[TODO: team to confirm which of these existed before 27 November.]**
- **During the hackathon, other parts:** **[TODO: frontend, listing finder, README, video — owners
  to add.]**
- AI assistance: parts of the code, tests and documentation were written with Claude Code and
  reviewed by the team. **[TODO: confirm wording against the hackathon rules.]**

## Known limits

- **Prototype on devnet with mock USDC.** No signed lender or SPV partner (see
  [docs/LEGAL.md](docs/LEGAL.md)). Each country needs local counsel.
- **No KYC on deposits.** The allowlist hook exists but is disabled.
- **No underwriter stake** (stretch goal, not built); that rung of the loss order does not exist.
- **No `top_up_escrow`** (stretch goal, not built). If an appraisal comes in below the price, the
  loan is rejected and the borrower re-applies with a larger down payment; it is never shrunk.
- **No fuzz or property-based tests.** Correctness rests on fixed-case unit tests, LiteSVM and
  local-validator integration tests, the invariant checks run after every instruction, and the
  stress simulation. Randomised input testing of `math.rs` and `nav.rs` is future work.
- **First-loss capital is assumed.** In the demo the platform supplies it. The pool's first-loss
  vault (350k for a 7M pool) costs more than the yearly platform income (about 56k); funding it
  in a real product is an open question.
- **NAV timing.** Interest enters NAV when an instalment is paid. A 0.2% entry/exit fee mitigates
  deposit-before-payment arbitrage; daily accrual is future work.
- **Approved loans do not expire** and anyone may fund one, so an old appraisal can be used to fund
  later. An expiry is under discussion.
- **More is public on-chain than "band only".** The loan stores the exact price, principal and
  appraised value, and the borrower and seller wallet addresses (see [docs/LEGAL.md](docs/LEGAL.md)).
- **Title confirmation is a trusted role.** Real identity and registry checks happen off-chain at
  the title agent.
- **Late-ratio brake depends on the crank** that updates `late_default_principal`. `crank_loan` is
  permissionless and idempotent (status is derived from the Solana Clock, the same period is never
  processed twice). `repay`, `payoff`, `request_withdraw`, `process_withdrawals`, `crank_loan` and
  `record_recovery` are implemented and covered by LiteSVM tests.
- **Recovery proceeds use a single trusted signer.** `record_recovery` pulls the sale proceeds from
  the recovery agent's USDC account with a real transfer; below `min_recovery_bps × value` the pool
  admin must co-sign. The target design (escrow PDA + CPI + 2-of-3 signatures) is **not built**
  (`TODO(2of3)` in `record_recovery.rs`).
- **Withdrawals are a FIFO queue with no per-period gate.** At most 3 requests are processed per
  transaction, each at the NAV of that moment, only from idle cash, never partially. If the request
  at the head of the queue cannot be paid, the queue waits (`InsufficientIdleCash`); a request whose
  payout account was closed is skipped so the queue never locks.
- **Collateral cut at Late2 is a prepayment, not an instalment.** The cut pays late fee, interest and
  principal but does not advance the due date; the interest it paid is deducted from the accrued
  interest at default (so it is not counted twice). A borrower who cures pays the missed instalments
  in full and the collateral gap is not refilled (stretch).
- **Stress simulation:** the house and 2008-mode results are measured on the real program; the
  vehicle results are an estimate (damage, theft and second-hand discounts are not modelled).
- **Vehicle numbers use the house safety parameters** (provision, brakes, buffer, fee); the
  vehicle stress table is an estimate.

## Future work

Daily interest accrual and an index-linked provision for active loans; per-period withdrawal gate
(for example 2.5%); Token-2022 transfer hook for KYC-gated shares; underwriter stake; a junior
tranche for outside first-loss capital; licensed-lender and SPV integration; formal verification
and an independent audit.

## Team

| Role | Scope | Name |
|---|---|---|
| Backend A | money flow: pool, deposit, loan lifecycle, math, NAV, deploy | [beratvarlik](https://github.com/beratvarlik) |
| Backend B | repayment, withdrawals, crank, recovery, risk logic, tests, stress simulation | Emir Musa Karaduman ([emirmusakaraduman](https://github.com/emirmusakaraduman)) |
| Frontend | app, listing finder, demo | Mustafa Baha Faik ([mustafabahafaik](https://github.com/mustafabahafaik)) |

## License

[MIT](LICENSE). See [docs/LEGAL.md](docs/LEGAL.md) for the legal notes that go with this project.
