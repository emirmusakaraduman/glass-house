// fund_loan ve approve_loan kuralları (LiteSVM, gerçek instruction'lar). 70.000 USDC'lik ev kredisi
// (fiyat 100.000, peşinat 30.000). Kurallar: docs/CLAUDE.md "fund_loan kuralları".

import { expect } from "chai";
import {
  assertInvariants,
  fundLoanIx,
  getUnixTimestamp,
  HOUSE_PARAMS,
  loanPdas,
  LoanStatus,
  MODE_2008_PARAMS,
  patchPool,
  PoolStatus,
  readLoan,
  readPool,
  sendTx,
  tokenBalance,
  USDC,
} from "./helpers";
import { approvedLoan, approveLoanIx, expectAnchorError, pendingLoan, setupPool } from "./lib/ixs";

const PRINCIPAL = 70_000n * USDC;
const FEE = 700n * USDC; // %1 açılış ücreti

describe("fund_loan", () => {
  it("fonlama: para vault'tan escrow'a, sayaçlar ve süre doğru; ücretin yarısı reserve_pending'e", async () => {
    const { env, pool } = setupPool();
    const loan = await approvedLoan(env, pool);
    const p0 = readPool(env, pool.pool);
    const now = getUnixTimestamp(env);
    sendTx(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger]);

    const l = readLoan(env, loan);
    const p = readPool(env, pool.pool);
    const { escrow } = loanPdas(env.programId, pool.pool, l.id);
    expect(l.status).to.equal(LoanStatus.Funded);
    expect(l.fundedAt).to.equal(now);
    expect(l.titleDeadline).to.equal(now + p.titleTimeoutSeconds);
    expect(p0.idleCash - p.idleCash).to.equal(PRINCIPAL);
    expect(p.totalOutstanding).to.equal(PRINCIPAL);
    expect(p.reservePending).to.equal(FEE / 2n);
    expect(p.reserveBalance).to.equal(p0.reserveBalance); // token hâlâ escrow'da
    expect(tokenBalance(env, escrow)).to.equal(100_000n * USDC + FEE); // peşinat + ücret + anapara
    expect(tokenBalance(env, pool.vault)).to.equal(p.idleCash);
    assertInvariants(env, pool, [loan]);
  });

  it("yalnızca Approved kredi fonlanır (Pending ve ikinci fonlama InvalidStatus)", async () => {
    const { env, pool } = setupPool();
    const pending = await pendingLoan(env, pool);
    expectAnchorError(env, [await fundLoanIx(env, pool, pending)], [env.wallets.stranger], "InvalidStatus");

    const loan = await approvedLoan(env, pool);
    sendTx(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger]);
    expectAnchorError(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger], "InvalidStatus");
    assertInvariants(env, pool, [pending, loan]);
  });

  it("herkes fonlayabilir: yabancı, borçlu, satıcı, yatırımcı (izinsiz)", async () => {
    for (const who of ["stranger", "borrower1", "seller", "investor1"] as const) {
      const { env, pool } = setupPool();
      const loan = await approvedLoan(env, pool);
      const w = env.wallets[who];
      sendTx(env, [await fundLoanIx(env, pool, loan, w.publicKey)], [w]);
      expect(readLoan(env, loan).status).to.equal(LoanStatus.Funded);
    }
  });

  it("likidite tamponu: fonlama sonrası idle ≥ %10 × NAV; sınırın iki yanı", async () => {
    // idle − 70.000 ≥ 0,1 × idle  ⇔  idle ≥ 77.777,78
    const tight = setupPool(HOUSE_PARAMS, { liquidity: 77_777n * USDC, firstLoss: 3_500n * USDC });
    const l1 = await approvedLoan(tight.env, tight.pool);
    expectAnchorError(tight.env, [await fundLoanIx(tight.env, tight.pool, l1)], [tight.env.wallets.stranger], "LiquidityBufferBreached");
    expect(readLoan(tight.env, l1).status).to.equal(LoanStatus.Approved);

    const ok = setupPool(HOUSE_PARAMS, { liquidity: 77_778n * USDC, firstLoss: 3_500n * USDC });
    const l2 = await approvedLoan(ok.env, ok.pool);
    sendTx(ok.env, [await fundLoanIx(ok.env, ok.pool, l2)], [ok.env.wallets.stranger]);
    expect(readLoan(ok.env, l2).status).to.equal(LoanStatus.Funded);
    assertInvariants(ok.env, ok.pool, [l2]);
  });

  it("havuzda anaparadan az nakit varsa reddedilir (LiquidityBufferBreached)", async () => {
    const { env, pool } = setupPool(HOUSE_PARAMS, { liquidity: 50_000n * USDC, firstLoss: 3_500n * USDC });
    const loan = await approvedLoan(env, pool);
    expectAnchorError(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger], "LiquidityBufferBreached");
  });

  it("ilk zarar kuralı: kasa ≥ %5 × (outstanding + anapara); sınırın iki yanı", async () => {
    const low = setupPool(HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 3_500n * USDC - 1n });
    const l1 = await approvedLoan(low.env, low.pool);
    expectAnchorError(low.env, [await fundLoanIx(low.env, low.pool, l1)], [low.env.wallets.stranger], "InsufficientFirstLoss");

    const ok = setupPool(HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 3_500n * USDC });
    const l2 = await approvedLoan(ok.env, ok.pool);
    sendTx(ok.env, [await fundLoanIx(ok.env, ok.pool, l2)], [ok.env.wallets.stranger]);
    expect(readLoan(ok.env, l2).status).to.equal(LoanStatus.Funded);
  });

  it("ikinci kredi toplam anaparaya göre kasa ister (5.000 kasa: ilk kredi geçer, ikincisi InsufficientFirstLoss)", async () => {
    const { env, pool } = setupPool(HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 5_000n * USDC });
    const s = env.wallets.stranger;
    const a = await approvedLoan(env, pool);
    sendTx(env, [await fundLoanIx(env, pool, a)], [s]); // 3.500 ≤ 5.000
    const b = await approvedLoan(env, pool);
    expectAnchorError(env, [await fundLoanIx(env, pool, b)], [s], "InsufficientFirstLoss"); // 7.000 > 5.000
    assertInvariants(env, pool, [a, b]);
  });

  it("yedek fon freni: reserve + pending < %0,25 × outstanding → BrakeReserve; 2008 modunda (fren 0) geçer", async () => {
    for (const mode of ["house", "2008"] as const) {
      const params = mode === "house" ? HOUSE_PARAMS : { ...MODE_2008_PARAMS, brakeReserveBps: 0 };
      const { env, pool } = setupPool(params, { liquidity: 1_000_000n * USDC, firstLoss: 60_000n * USDC });
      const s = env.wallets.stranger;
      const a = await approvedLoan(env, pool);
      sendTx(env, [await fundLoanIx(env, pool, a)], [s]);
      patchPool(env, pool.pool, { reservePending: 0n, reserveBalance: 0n }); // yedek eridi
      const b = await approvedLoan(env, pool);
      if (mode === "house") {
        expectAnchorError(env, [await fundLoanIx(env, pool, b)], [s], "BrakeReserve");
        expect(readLoan(env, b).status).to.equal(LoanStatus.Approved);
      } else {
        sendTx(env, [await fundLoanIx(env, pool, b)], [s]);
        expect(readLoan(env, b).status).to.equal(LoanStatus.Funded);
      }
    }
  });

  it("duraklatılmış havuzda fonlanamaz (InvalidStatus)", async () => {
    const { env, pool } = setupPool();
    const loan = await approvedLoan(env, pool);
    patchPool(env, pool.pool, { status: PoolStatus.Paused });
    expectAnchorError(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger], "InvalidStatus");
  });
});

describe("approve_loan: ekspertiz / LTV", () => {
  it("LTV min(fiyat, ekspertiz) üzerinden: 99.999,99 reddedilir (AppraisalTooLow), 100.000 ve üstü geçer", async () => {
    const { env, pool } = setupPool();
    const uw = env.wallets.underwriter;
    const loan = await pendingLoan(env, pool);
    expectAnchorError(env, [await approveLoanIx(env, pool, loan, uw.publicKey, "approve", 100_000n * USDC - 10_000n)], [uw], "AppraisalTooLow");
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Pending);

    sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey, "approve", 100_000n * USDC)], [uw]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Approved);

    // Ekspertiz fiyattan yüksekse LTV yine fiyat üzerinden hesaplanır (min); kredi yine geçer.
    const loan2 = await pendingLoan(env, pool);
    sendTx(env, [await approveLoanIx(env, pool, loan2, uw.publicKey, "approve", 150_000n * USDC)], [uw]);
    const l2 = readLoan(env, loan2);
    expect(l2.status).to.equal(LoanStatus.Approved);
    expect(l2.valueBand).to.equal(150_000n * USDC); // ev: 50.000'lik bant
  });
});
