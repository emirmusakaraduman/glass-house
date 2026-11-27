import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  assertInvariants,
  BPS,
  collateralDeducted,
  crankLoanIx,
  createPool,
  expectTxFail,
  fundUsdc,
  getUnixTimestamp,
  HOUSE_PARAMS,
  loanMath,
  loanPdas,
  LoanStatus,
  PoolHandle,
  readLoan,
  readPool,
  repayIx,
  sendTx,
  setupEnv,
  TestEnv,
  tokenBalance,
  USDC,
  usdcAta,
  warp,
  writeLoanFixture,
} from "./helpers";

const ceilBps = (v: bigint, bps: number) => (v * BigInt(bps) + BPS - 1n) / BPS;

interface Ctx {
  env: TestEnv;
  pool: PoolHandle;
  loan: PublicKey;
}

function setup(opts: { remainingPrincipal?: bigint } = {}): Ctx {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {
    liquidity: 1_000_000n * USDC,
    firstLoss: 50_000n * USDC,
    reserve: 1_000n * USDC,
  });
  const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Active, ...opts });
  fundUsdc(env, env.wallets.borrower1.publicKey, 20_000n * USDC);
  return { env, pool, loan };
}

async function pay(c: Ctx, amount: bigint, payer: Keypair = c.env.wallets.borrower1) {
  sendTx(c.env, [await repayIx(c.env, c.pool, c.loan, amount, payer.publicKey)], [payer]);
  assertInvariants(c.env, c.pool, [c.loan]);
}

async function payFails(c: Ctx, amount: bigint, expected: string) {
  const b = c.env.wallets.borrower1;
  expectTxFail(c.env, [await repayIx(c.env, c.pool, c.loan, amount, b.publicKey)], [b], expected);
}

async function crank(c: Ctx) {
  const s = c.env.wallets.stranger;
  sendTx(c.env, [await crankLoanIx(c.env, c.pool, c.loan, s.publicKey)], [s]);
  assertInvariants(c.env, c.pool, [c.loan]);
}

describe("repay", () => {
  it("zamanında taksit: faiz/anapara bölüşümü ve transferler loanMath ile birebir", async () => {
    const c = setup();
    const { env, pool } = c;
    const l0 = readLoan(env, c.loan);
    const p0 = readPool(env, pool.pool);
    const payer0 = tokenBalance(env, usdcAta(env, env.wallets.borrower1.publicKey));
    const vault0 = tokenBalance(env, pool.vault);
    const reserve0 = tokenBalance(env, pool.reserve);
    const plat0 = tokenBalance(env, pool.platformTreasury);

    await pay(c, l0.installment);

    const split = loanMath.splitPayment(l0.installment, l0.remainingPrincipal, l0.rateBps, 0n);
    const [poolInt, platInt, resInt] = loanMath.splitInterest(split.interest, l0.rateBps);
    // Maria: ilk ay 408,33 faiz + 134,38 anapara
    expect(Number(split.interest) / 1e6).to.be.closeTo(408.33, 0.01);
    expect(Number(split.principal) / 1e6).to.be.closeTo(134.38, 0.01);

    const l = readLoan(env, c.loan);
    const p = readPool(env, pool.pool);
    expect(l.status).to.equal(LoanStatus.Active);
    expect(l.paidInstallments).to.equal(1);
    expect(l.nextDue).to.equal(l0.nextDue + 60n);
    expect(l.remainingPrincipal).to.equal(l0.remainingPrincipal - split.principal);
    expect(payer0 - tokenBalance(env, usdcAta(env, env.wallets.borrower1.publicKey))).to.equal(l0.installment);
    expect(tokenBalance(env, pool.vault) - vault0).to.equal(poolInt + split.principal);
    expect(tokenBalance(env, pool.reserve) - reserve0).to.equal(resInt);
    expect(tokenBalance(env, pool.platformTreasury) - plat0).to.equal(platInt);
    expect(p.idleCash - p0.idleCash).to.equal(poolInt + split.principal);
    expect(p.reserveBalance - p0.reserveBalance).to.equal(resInt);
    expect(p0.totalOutstanding - p.totalOutstanding).to.equal(split.principal);
  });

  it("borçlu dışında biri de ödeyebilir (Blink)", async () => {
    const c = setup();
    const s = c.env.wallets.stranger;
    fundUsdc(c.env, s.publicKey, 1_000n * USDC);
    const inst = readLoan(c.env, c.loan).installment;
    await pay(c, inst, s);
    expect(readLoan(c.env, c.loan).paidInstallments).to.equal(1);
  });

  it("kısmi ödeme borca uygulanır ama vadeyi ilerletmez", async () => {
    const c = setup();
    const l0 = readLoan(c.env, c.loan);
    await pay(c, 100n * USDC);
    const l = readLoan(c.env, c.loan);
    expect(l.paidInstallments).to.equal(0);
    expect(l.nextDue).to.equal(l0.nextDue);
    const interest = loanMath.interestForPeriod(l0.remainingPrincipal, l0.rateBps);
    expect(l.remainingPrincipal).to.equal(l0.remainingPrincipal); // 100 < faiz → anapara düşmez
    expect(interest > 100n * USDC).to.equal(true);
  });

  it("sıfır ve borçtan fazla ödeme reddedilir", async () => {
    const c = setup();
    const l = readLoan(c.env, c.loan);
    await payFails(c, 0n, "ZeroAmount");
    const max = loanMath.finalInstallment(l.remainingPrincipal, l.rateBps);
    fundUsdc(c.env, c.env.wallets.borrower1.publicKey, max + 10n * USDC);
    await payFails(c, max + 1n, "InvalidPaymentAmount");
  });

  it("Late1 → gecikme bedeli + taksit ödenince Active'e döner", async () => {
    const c = setup();
    warp(c.env, 70);
    await crank(c);
    let l = readLoan(c.env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late1);
    const fee = l.lateFeeAccrued;

    // Yalnızca taksit: önce gecikme bedeli düşer, dönem kapanmaz → Late1 kalır.
    await pay(c, l.installment);
    l = readLoan(c.env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late1);
    expect(l.lateFeeAccrued).to.equal(0n);
    expect(l.paidInstallments).to.equal(0);

    // Eksik kalan (bedel kadar) ödenir — yeni çağrı tam taksit ister.
    await pay(c, l.installment);
    l = readLoan(c.env, c.loan);
    const p = readPool(c.env, c.pool.pool);
    expect(fee > 0n).to.equal(true);
    expect(l.status).to.equal(LoanStatus.Active);
    expect(l.paidInstallments).to.equal(1);
    expect(l.lastProcessedPeriod).to.equal(0n);
    expect(l.missedInstallments).to.equal(0);
    expect(l.provisionAmount).to.equal(0n);
    expect(p.lossProvision).to.equal(0n);
    expect(p.lateDefaultPrincipal).to.equal(0n);
  });

  it("Late2 → iki taksitle Active; teminat açığı kalıcı izlenir, sonraki gecikmede tekrar kesilir", async () => {
    const c = setup();
    const { env, pool } = c;
    const inst = readLoan(env, c.loan).installment;
    const { collateral } = loanPdas(env.programId, pool.pool, readLoan(env, c.loan).id);

    warp(env, 70 + 60);
    await crank(c); // 0 → Late2 (Late1 bedeli + teminattan kesinti)
    let l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(collateralDeducted(l)).to.equal(inst);
    expect(tokenBalance(env, collateral)).to.equal(2n * inst);

    await pay(c, inst); // bir dönem kapanır, hâlâ bir vade geçmiş
    l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(l.lastProcessedPeriod).to.equal(2n);
    expect(readPool(env, pool.pool).lateDefaultPrincipal).to.equal(l.remainingPrincipal);
    expect(l.provisionAmount).to.equal(ceilBps(l.remainingPrincipal, 1500));

    await pay(c, inst); // ikinci dönem → Active
    l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Active);
    expect(l.lastProcessedPeriod).to.equal(0n);
    expect(collateralDeducted(l)).to.equal(inst); // teminat yeniden dolmadı
    expect(readPool(env, pool.pool).lateDefaultPrincipal).to.equal(0n);

    // Yeni gecikme: crank invariant'a takılmadan Late2'de kalan teminattan keser.
    const dueGap = l.nextDue + 10n + 60n - getUnixTimestamp(env);
    warp(env, dueGap);
    await crank(c);
    l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(collateralDeducted(l)).to.equal(2n * inst);
    expect(tokenBalance(env, collateral)).to.equal(inst);
  });

  it("son ödeme krediyi PaidOff yapar; sonrasında ödeme alınmaz", async () => {
    const c = setup({ remainingPrincipal: 300n * USDC });
    const l0 = readLoan(c.env, c.loan);
    const final = loanMath.finalInstallment(l0.remainingPrincipal, l0.rateBps);
    const out0 = readPool(c.env, c.pool.pool).totalOutstanding;
    await pay(c, final);
    const l = readLoan(c.env, c.loan);
    expect(l.status).to.equal(LoanStatus.PaidOff);
    expect(l.remainingPrincipal).to.equal(0n);
    expect(out0 - readPool(c.env, c.pool.pool).totalOutstanding).to.equal(300n * USDC);
    await payFails(c, 1n * USDC, "LoanNotServiceable");
  });

  it("Defaulted krediye ödeme alınmaz", async () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 100_000n * USDC });
    const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Defaulted });
    fundUsdc(env, env.wallets.borrower1.publicKey, 1_000n * USDC);
    const b = env.wallets.borrower1;
    expectTxFail(env, [await repayIx(env, pool, loan, 100n * USDC, b.publicKey)], [b], "LoanNotServiceable");
  });
});
