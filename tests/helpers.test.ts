import { expect } from "chai";
import {
  annuityInstallment,
  createPool,
  fundUsdc,
  getUnixTimestamp,
  HOUSE_PARAMS,
  loanPdas,
  LoanStatus,
  LOAN_SIZE,
  MODE_2008_PARAMS,
  POOL_SIZE,
  readLoan,
  readPool,
  setupEnv,
  tokenBalance,
  USDC,
  VEHICLE_PARAMS,
  warp,
  warpPeriods,
  writeLoanFixture,
} from "./helpers";

describe("helpers", () => {
  it("program yüklenir ve 9 cüzdan fonlanır", () => {
    const env = setupEnv();
    expect(env.svm.getAccount(env.programId)?.executable).to.equal(true);
    expect(Object.keys(env.wallets)).to.have.length(9);
    for (const kp of Object.values(env.wallets)) {
      expect((env.svm.getBalance(kp.publicKey) ?? 0n) > 0n).to.equal(true);
    }
  });

  it("USDC fonlama ATA'ya yazar", () => {
    const env = setupEnv();
    const ata = fundUsdc(env, env.wallets.investor1.publicKey, 1_000n * USDC);
    expect(tokenBalance(env, ata)).to.equal(1_000n * USDC);
    fundUsdc(env, env.wallets.investor1.publicKey, 250n * USDC);
    expect(tokenBalance(env, ata)).to.equal(250n * USDC);
  });

  it("hesap boyutları state.rs ile aynı (8 + InitSpace)", () => {
    expect(POOL_SIZE).to.equal(419);
    expect(LOAN_SIZE).to.equal(350);
  });

  it("havuz parametreleri ve PDA bump'ları yazılır", () => {
    const env = setupEnv();
    const pool = createPool(env, VEHICLE_PARAMS, { liquidity: 10n * USDC });
    const p = readPool(env, pool.pool);
    expect(p.maxLtvBps).to.equal(6000);
    expect(p.rateBps).to.equal(900);
    expect(p.termMonths).to.equal(60);
    expect(p.recoveryCoeffBps).to.equal(5400);
    expect(p.periodSeconds).to.equal(60n);
    expect(p.graceSeconds).to.equal(10n);
    expect(p.bump).to.equal(pool.bumps.pool);
    expect(p.recoveryAgent.equals(env.recoveryAgent.publicKey)).to.equal(true);

    const m = createPool(env, { ...MODE_2008_PARAMS, poolId: 7n });
    expect(readPool(env, m.pool).maxLtvBps).to.equal(9700);
    expect(readPool(env, m.pool).minFirstLossBps).to.equal(0);
  });

  it("kredi fixture'ı duruma göre alanları doldurur ve havuz sayaçlarını günceller", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 1_000_000n * USDC });

    const active = writeLoanFixture(env, pool, { status: LoanStatus.Active });
    const late2 = writeLoanFixture(env, pool, { status: LoanStatus.Late2 });
    expect(active.id).to.equal(0n);
    expect(late2.id).to.equal(1n);
    expect(active.loan.equals(loanPdas(env.programId, pool.pool, 0n).loan)).to.equal(true);

    const l = readLoan(env, late2.loan);
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(l.missedInstallments).to.equal(2);
    expect(l.principal).to.equal(70_000n * USDC);
    expect(l.installment).to.equal(annuityInstallment(70_000n * USDC, 700, 240));
    expect(l.provisionAmount).to.equal((70_000n * USDC * 1500n) / 10_000n);
    expect(tokenBalance(env, late2.collateral)).to.equal(2n * l.installment);

    const p = readPool(env, pool.pool);
    expect(p.nextLoanId).to.equal(2n);
    expect(p.totalOutstanding).to.equal(140_000n * USDC);
    expect(p.lateDefaultPrincipal).to.equal(70_000n * USDC);
    expect(p.lossProvision).to.equal(l.provisionAmount);
  });

  it("annüite taksidi belgedeki örneklerle uyumlu (±1 cent)", () => {
    // Maria: 70.000 USD, %7, 240 ay → 542,71 · Diego: 12.000 USD, %9, 60 ay → 249,10
    const house = annuityInstallment(70_000n * USDC, 700, 240);
    const car = annuityInstallment(12_000n * USDC, 900, 60);
    expect(Number(house) / 1e6).to.be.closeTo(542.71, 0.01);
    expect(Number(car) / 1e6).to.be.closeTo(249.1, 0.01);
  });

  it("warp saati ileri alır", () => {
    const env = setupEnv({ startUnixTs: 1_000n });
    const pool = createPool(env, HOUSE_PARAMS);
    expect(getUnixTimestamp(env)).to.equal(1_000n);
    expect(warp(env, 15)).to.equal(1_015n);
    expect(warpPeriods(env, pool, 2, 10n)).to.equal(1_015n + 130n);
    expect(getUnixTimestamp(env)).to.equal(1_145n);
  });
});
