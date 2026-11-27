// Kredi akışı testleri (LiteSVM, gerçek instruction'lar): approve_loan Reject iadesi, cancel_funding,
// tescil süresi, araç havuzu uçtan uca (Diego), havuzların izolasyonu.

import { expect } from "chai";
import {
  assertInvariants,
  crankLoanIx,
  createPool,
  fundLoanIx,
  HOUSE_PARAMS,
  loanMath,
  loanPdas,
  LoanStatus,
  readLoan,
  readPool,
  repayIx,
  sendTx,
  tokenBalance,
  USDC,
  usdcAta,
  VEHICLE_PARAMS,
  warp,
  writeLoanFixture,
} from "./helpers";
import {
  activeLoan,
  applyLoanIx,
  approveLoanIx,
  cancelFundingIx,
  confirmTitleIx,
  expectAnchorError,
  failureLogs,
  fundedLoan,
  pendingLoan,
  setupPool,
  VEHICLE_PRICE,
} from "./lib/ixs";

const gone = (env: any, a: any) => {
  const acc = env.svm.getAccount(a);
  return !acc || acc.lamports === 0;
};

describe("approve_loan Reject", () => {
  it("peşinat + ücret + teminat borçluya tam iade edilir; escrow hesapları kapanır; havuz sayaçları değişmez", async () => {
    const { env, pool } = setupPool();
    const b = env.wallets.borrower1;
    const uw = env.wallets.underwriter;
    const before = tokenBalance(env, usdcAta(env, b.publicKey));
    const p0 = readPool(env, pool.pool);

    const loan = await pendingLoan(env, pool);
    const l = readLoan(env, loan);
    const { escrow, collateral } = loanPdas(env.programId, pool.pool, l.id);
    expect(tokenBalance(env, usdcAta(env, b.publicKey)) < before).to.equal(true);

    sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey, "reject")], [uw]);

    expect(readLoan(env, loan).status).to.equal(LoanStatus.Rejected);
    expect(tokenBalance(env, usdcAta(env, b.publicKey))).to.equal(before); // tam iade
    expect(gone(env, escrow)).to.equal(true);
    expect(gone(env, collateral)).to.equal(true);
    const p = readPool(env, pool.pool);
    expect([p.idleCash, p.totalOutstanding, p.reservePending]).to.deep.equal([p0.idleCash, 0n, 0n]);
    expect(p.nextLoanId).to.equal(1n);
    assertInvariants(env, pool);
  });

  it("reddedilen kredi tekrar onaylanamaz / reddedilemez; fonlanamaz", async () => {
    const { env, pool } = setupPool();
    const uw = env.wallets.underwriter;
    const loan = await pendingLoan(env, pool);
    sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey, "reject")], [uw]);
    const again = failureLogs(env, [await approveLoanIx(env, pool, loan, uw.publicKey, "approve")], [uw]);
    expect(again).to.match(/AccountNotInitialized|InvalidStatus/);
    // Escrow hesapları kapandığı için fonlama hesap doğrulamasında düşer.
    expectAnchorError(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger], "AccountNotInitialized");
  });
});

describe("cancel_funding ve tescil süresi", () => {
  const TIMEOUT = { ...HOUSE_PARAMS, titleTimeoutSeconds: 60n };

  it("süre dolmadan iptal edilemez (TitleDeadlineNotReached); dolunca herkes iptal eder: her şey iade edilir", async () => {
    const { env, pool } = setupPool(TIMEOUT);
    const b = env.wallets.borrower1;
    const before = tokenBalance(env, usdcAta(env, b.publicKey));
    const p0 = readPool(env, pool.pool);
    const loan = await fundedLoan(env, pool);
    const { escrow, collateral } = loanPdas(env.programId, pool.pool, readLoan(env, loan).id);

    const s = env.wallets.stranger;
    expectAnchorError(env, [await cancelFundingIx(env, pool, loan, s.publicKey)], [s], "TitleDeadlineNotReached");
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Funded);

    warp(env, 61);
    sendTx(env, [await cancelFundingIx(env, pool, loan, s.publicKey)], [s]);

    const p = readPool(env, pool.pool);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Cancelled);
    expect([p.idleCash, p.totalOutstanding, p.reservePending]).to.deep.equal([p0.idleCash, 0n, 0n]);
    expect(tokenBalance(env, pool.vault)).to.equal(p0.idleCash);
    expect(tokenBalance(env, usdcAta(env, b.publicKey))).to.equal(before); // peşinat + ücret + teminat geri
    expect(gone(env, escrow)).to.equal(true);
    expect(gone(env, collateral)).to.equal(true);
    assertInvariants(env, pool);
  });

  it("süre dolduktan sonra confirm_title reddedilir (TitleDeadlinePassed); satıcıya ödeme çıkmaz", async () => {
    const { env, pool } = setupPool(TIMEOUT);
    const loan = await fundedLoan(env, pool);
    warp(env, 61);
    const agent = env.wallets.titleAgent;
    const seller = usdcAta(env, env.wallets.seller.publicKey);
    expectAnchorError(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent], "TitleDeadlinePassed");
    expect(tokenBalance(env, seller)).to.equal(0n);
  });

  it("onaylanmış (Active) ya da fonlanmamış kredi iptal edilemez (InvalidStatus)", async () => {
    const { env, pool } = setupPool(TIMEOUT);
    const s = env.wallets.stranger;
    const active = await activeLoan(env, pool);
    warp(env, 61);
    expectAnchorError(env, [await cancelFundingIx(env, pool, active, s.publicKey)], [s], "InvalidStatus");

    const pending = await pendingLoan(env, pool);
    expectAnchorError(env, [await cancelFundingIx(env, pool, pending, s.publicKey)], [s], "InvalidStatus");
  });
});

describe("araç havuzu uçtan uca (Diego: 20.000 USD araç, %40 peşinat, %9, 60 ay)", () => {
  it("peşinat %40'ın altı reddedilir; kabul edilen kredinin sayıları PDF'le uyumlu", async () => {
    const { env, pool } = setupPool(VEHICLE_PARAMS, { liquidity: 100_000n * USDC, firstLoss: 5_000n * USDC });
    const diego = env.wallets.borrower2;
    const seller = env.wallets.seller;

    // 7.999,99 USDC peşinat: %40'ın 0,01 altı.
    const low = await applyLoanIx(env, pool, diego.publicKey, seller.publicKey, VEHICLE_PRICE, 8_000n * USDC - 10_000n);
    expectAnchorError(env, [low], [diego, seller], "InsufficientDownPayment");
    expect(readPool(env, pool.pool).nextLoanId).to.equal(0n);

    const before = tokenBalance(env, usdcAta(env, diego.publicKey));
    const loan = await pendingLoan(env, pool, { borrower: diego });
    const l = readLoan(env, loan);
    const { collateral } = loanPdas(env.programId, pool.pool, l.id);
    expect(l.principal).to.equal(12_000n * USDC);
    expect(Number(l.installment) / 1e6).to.be.closeTo(249.1, 0.011); // PDF: 249,10
    expect(tokenBalance(env, collateral)).to.equal(3n * l.installment); // 3 taksit ≈ 747
    // Kapanışta cepten çıkan: 8.000 + 120 (ücret) + 747 (teminat) ≈ 8.867
    const spent = before - tokenBalance(env, usdcAta(env, diego.publicKey));
    expect(Number(spent) / 1e6).to.be.closeTo(8_867.3, 0.05);
  });

  it("onay (değer bandı 5k), fonlama, tescil → Active; ilk taksit 90,00 faiz + 159,10 anapara", async () => {
    const { env, pool } = setupPool(VEHICLE_PARAMS, { liquidity: 100_000n * USDC, firstLoss: 5_000n * USDC });
    const diego = env.wallets.borrower2;
    const loan = await activeLoan(env, pool, { borrower: diego });
    let l = readLoan(env, loan);
    expect(l.status).to.equal(LoanStatus.Active);
    expect(l.valueBand).to.equal(20_000n * USDC); // araç: 5.000'lik bant
    expect(readPool(env, pool.pool).reserveBalance).to.equal(60n * USDC); // 120 USD ücretin yarısı

    const split = loanMath.splitPayment(l.installment, l.remainingPrincipal, l.rateBps, 0n);
    expect(Number(split.interest) / 1e6).to.be.closeTo(90.0, 0.011);
    expect(Number(split.principal) / 1e6).to.be.closeTo(159.1, 0.011);

    sendTx(env, [await repayIx(env, pool, loan, l.installment, diego.publicKey)], [diego]);
    l = readLoan(env, loan);
    expect(l.remainingPrincipal).to.equal(12_000n * USDC - split.principal);
    expect(l.paidInstallments).to.equal(1);
    assertInvariants(env, pool, [loan]);
  });
});

describe("izole havuzlar", () => {
  it("ev havuzundaki temerrüt araç havuzuna dokunmaz; kredi başka havuzun hesaplarıyla çağrılamaz", async () => {
    const { env, pool: house } = setupPool(HOUSE_PARAMS, {
      liquidity: 1_000_000n * USDC,
      firstLoss: 60_000n * USDC,
    });
    const vehicle = createPool(env, { ...VEHICLE_PARAMS, poolId: 1n }, { liquidity: 100_000n * USDC, firstLoss: 5_000n * USDC });
    const houseLoan = writeLoanFixture(env, house, { status: LoanStatus.Active }).loan;
    const vehicleBefore = readPool(env, vehicle.pool);

    warp(env, 70 + 2 * 60); // 3 taksit kaçtı
    sendTx(env, [await crankLoanIx(env, house, houseLoan)], [env.wallets.stranger]);
    expect(readLoan(env, houseLoan).status).to.equal(LoanStatus.Defaulted);

    expect(readPool(env, vehicle.pool)).to.deep.equal(vehicleBefore); // araç havuzu değişmedi
    expect(tokenBalance(env, vehicle.vault)).to.equal(100_000n * USDC);
    expect(tokenBalance(env, vehicle.firstLoss)).to.equal(5_000n * USDC);

    // Ev kredisi araç havuzu hesaplarıyla işlenemez.
    const logs = failureLogs(env, [await crankLoanIx(env, vehicle, houseLoan)], [env.wallets.stranger]);
    expect(logs).to.match(/Error/);
  });
});
