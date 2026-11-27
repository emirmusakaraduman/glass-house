// crank_loan testleri (fixture ile; period_seconds = 60, grace_seconds = 10).
//
// - Durum Clock'tan türetilir; aynı dönem ikinci kez işlenmez (idempotent).
// - Gecikme sırası: Active → Late1 → Late2 → Defaulted. İzinsiz: "yabancı" cüzdan çağırır.
// - Her testin sonunda assertInvariants çağrılır (başarısız çağrılar dahil).

import { expect } from "chai";
import { EventParser } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  assertInvariants,
  BPS,
  crankLoanIx,
  createPool,
  expectTxFail,
  fundLoanIx,
  HOUSE_PARAMS,
  loanMath,
  loanPdas,
  LoanStatus,
  PoolHandle,
  readLoan,
  readPool,
  sendTx,
  setupEnv,
  TestEnv,
  tokenBalance,
  USDC,
  VEHICLE_PARAMS,
  warp,
  writeLoanFixture,
  writeTokenAccount,
} from "./helpers";

const ceilBps = (v: bigint, bps: number) => (v * BigInt(bps) + BPS - 1n) / BPS;
const floorBps = (v: bigint, bps: number) => (v * BigInt(bps)) / BPS;
const max = (a: bigint, b: bigint) => (a > b ? a : b);

interface Ctx {
  env: TestEnv;
  pool: PoolHandle;
  loan: PublicKey;
}

function activeHouseLoan(): Ctx {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {
    liquidity: 1_000_000n * USDC,
    firstLoss: 50_000n * USDC,
    reserve: 1_000n * USDC,
  });
  const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Active });
  return { env, pool, loan };
}

async function crank(c: Ctx, signer = c.env.wallets.stranger) {
  sendTx(c.env, [await crankLoanIx(c.env, c.pool, c.loan, signer.publicKey)], [signer]);
  assertInvariants(c.env, c.pool, [c.loan]);
}

async function crankFails(c: Ctx, expected: string) {
  const s = c.env.wallets.stranger;
  expectTxFail(c.env, [await crankLoanIx(c.env, c.pool, c.loan, s.publicKey)], [s], expected);
  assertInvariants(c.env, c.pool, [c.loan]);
}

/** Kredi + havuz + teminat durumunun karşılaştırılabilir özeti (başarısız crank hiçbirini değiştirmemeli). */
function snapshot(c: Ctx) {
  const l = readLoan(c.env, c.loan);
  const p = readPool(c.env, c.pool.pool);
  const { collateral } = loanPdas(c.env.programId, c.pool.pool, l.id);
  return {
    status: l.status,
    missed: l.missedInstallments,
    lastProcessed: l.lastProcessedPeriod,
    provision: l.provisionAmount,
    lateFee: l.lateFeeAccrued,
    remaining: l.remainingPrincipal,
    poolProvision: p.lossProvision,
    poolLate: p.lateDefaultPrincipal,
    poolOutstanding: p.totalOutstanding,
    poolIdle: p.idleCash,
    poolReserve: p.reserveBalance,
    collateral: tokenBalance(c.env, collateral),
  };
}

/** İşlemin loglarından `LoanCranked` event'lerini çözer. */
function crankedEvents(c: Ctx, logs: string[]) {
  const program = c.env.program!;
  const parser = new EventParser(c.env.programId, program.coder);
  return [...parser.parseLogs(logs)].filter((e) => e.name.toLowerCase() === "loancranked");
}

describe("crank_loan", () => {
  it("vade + grace dolmadan reddedilir", async () => {
    const c = activeHouseLoan();
    await crankFails(c, "PeriodAlreadyProcessed");
    warp(c.env, 60 + 9); // next_due = şimdi + 60, grace 10 → 1 sn kala
    await crankFails(c, "PeriodAlreadyProcessed");
  });

  it("aynı dönem iki kez çağrılınca durum, karşılık ve bakiyeler değişmez (idempotent)", async () => {
    const c = activeHouseLoan();
    // Late1, Late2, Defaulted: her adımda önce işle, sonra aynı dönemde tekrar dene.
    const steps: [number, LoanStatus, string][] = [
      [60 + 10, LoanStatus.Late1, "PeriodAlreadyProcessed"],
      [60, LoanStatus.Late2, "PeriodAlreadyProcessed"],
      [60, LoanStatus.Defaulted, "LoanNotServiceable"], // Defaulted'dan sonrası record_recovery'nin işi
    ];
    for (const [wait, status, error] of steps) {
      warp(c.env, wait);
      await crank(c);
      const after = snapshot(c);
      expect(after.status).to.equal(status);
      await crankFails(c, error);
      await crankFails(c, error); // üçüncü deneme de aynı
      expect(snapshot(c)).to.deep.equal(after);
    }
  });

  it("dönem içinde (60 sn dolmadan) tekrar çağrı: PeriodAlreadyProcessed, hiçbir şey değişmez", async () => {
    const c = activeHouseLoan();
    warp(c.env, 60 + 10);
    await crank(c); // Late1
    const after = snapshot(c);
    warp(c.env, 59); // sonraki adıma 1 sn var
    await crankFails(c, "PeriodAlreadyProcessed");
    expect(snapshot(c)).to.deep.equal(after);
  });

  it("yabancı (hiçbir rolü olmayan) cüzdan, borçlu ve satıcı da crank'leyebilir", async () => {
    for (const who of ["stranger", "borrower1", "seller"] as const) {
      const c = activeHouseLoan();
      warp(c.env, 60 + 10);
      await crank(c, c.env.wallets[who]);
      expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Late1);
    }
  });

  it("karşılık farkı: pool.loss_provision yalnızca yeni − eski kadar değişir (iki kredi)", async () => {
    const c = activeHouseLoan();
    const second = writeLoanFixture(c.env, c.pool, { status: LoanStatus.Active }).loan;
    const c2: Ctx = { ...c, loan: second };
    const p0 = readPool(c.env, c.pool.pool).lossProvision;
    expect(p0).to.equal(0n);

    warp(c.env, 60 + 10);
    await crank(c); // 1. kredi Late1: %5
    const prov1 = readLoan(c.env, c.loan).provisionAmount;
    expect(readPool(c.env, c.pool.pool).lossProvision).to.equal(prov1);

    await crank(c2); // 2. kredi Late1: toplam iki karşılık
    const provB = readLoan(c.env, second).provisionAmount;
    expect(readPool(c.env, c.pool.pool).lossProvision).to.equal(prov1 + provB);

    warp(c.env, 60);
    await crank(c); // 1. kredi Late2: toplamda yalnızca 1. kredinin farkı değişir
    const prov1b = readLoan(c.env, c.loan).provisionAmount;
    expect(prov1b > prov1).to.equal(true);
    expect(readPool(c.env, c.pool.pool).lossProvision).to.equal(prov1b + provB);
    assertInvariants(c.env, c.pool, [c.loan, second]);
  });

  it("LoanCranked event'i: eski/yeni durum, kaçırılan taksit ve karşılık farkı", async () => {
    const c = activeHouseLoan();
    const s = c.env.wallets.stranger;
    const run = async () =>
      sendTx(c.env, [await crankLoanIx(c.env, c.pool, c.loan, s.publicKey)], [s]).logs();

    warp(c.env, 60 + 10);
    let before = readPool(c.env, c.pool.pool).lossProvision;
    let ev = crankedEvents(c, await run());
    expect(ev).to.have.length(1);
    let d = ev[0].data as any;
    expect(d.oldStatus).to.equal(LoanStatus.Active);
    expect(d.newStatus).to.equal(LoanStatus.Late1);
    expect(d.missedInstallments).to.equal(1);
    expect(BigInt(d.provisionDelta.toString())).to.equal(readPool(c.env, c.pool.pool).lossProvision - before);
    expect(d.loanId.toString()).to.equal(readLoan(c.env, c.loan).id.toString());
    expect(d.pool.toBase58()).to.equal(c.pool.pool.toBase58());

    warp(c.env, 60);
    before = readPool(c.env, c.pool.pool).lossProvision;
    ev = crankedEvents(c, await run());
    d = ev[0].data as any;
    expect(d.oldStatus).to.equal(LoanStatus.Late1);
    expect(d.newStatus).to.equal(LoanStatus.Late2);
    expect(d.missedInstallments).to.equal(2);
    // Fark yeni − eski; toplam karşılık değil.
    expect(BigInt(d.provisionDelta.toString())).to.equal(readPool(c.env, c.pool.pool).lossProvision - before);
    expect(BigInt(d.collateralUsed.toString()) > 0n).to.equal(true);
    assertInvariants(c.env, c.pool, [c.loan]);
  });

  it("Active → Late1 → Late2 → Defaulted: tutarlar loanMath ile birebir", async () => {
    const c = activeHouseLoan();
    const { env, pool } = c;
    const l0 = readLoan(env, c.loan);
    const inst = l0.installment;
    const p0 = readPool(env, pool.pool);
    const vault0 = tokenBalance(env, pool.vault);
    const reserve0 = tokenBalance(env, pool.reserve);
    const platform0 = tokenBalance(env, pool.platformTreasury);
    const { collateral } = loanPdas(env.programId, pool.pool, l0.id);
    expect(tokenBalance(env, collateral)).to.equal(3n * inst);

    // ---- Late1 ----
    warp(env, 60 + 10);
    await crank(c);
    let l = readLoan(env, c.loan);
    let p = readPool(env, pool.pool);
    const lateFee = ceilBps(inst, 200);
    expect(l.status).to.equal(LoanStatus.Late1);
    expect(l.missedInstallments).to.equal(1);
    expect(l.lastProcessedPeriod).to.equal(1n);
    expect(l.lateFeeAccrued).to.equal(lateFee);
    expect(l.provisionAmount).to.equal(ceilBps(l0.remainingPrincipal, 500));
    expect(p.lossProvision).to.equal(l.provisionAmount);
    expect(p.lateDefaultPrincipal).to.equal(l0.remainingPrincipal);
    expect(tokenBalance(env, collateral)).to.equal(3n * inst);

    // Aynı dönem ikinci kez: reddedilir, durum değişmez.
    await crankFails(c, "PeriodAlreadyProcessed");
    expect(readLoan(env, c.loan).lateFeeAccrued).to.equal(lateFee);

    // ---- Late2: bir taksit teminattan ----
    warp(env, 60);
    await crank(c);
    l = readLoan(env, c.loan);
    p = readPool(env, pool.pool);
    const split = loanMath.splitPayment(inst, l0.remainingPrincipal, l0.rateBps, lateFee);
    const [poolInt, platInt, resInt] = loanMath.splitInterest(split.interest, l0.rateBps);
    const remaining2 = l0.remainingPrincipal - split.principal;
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(l.lastProcessedPeriod).to.equal(2n);
    expect(l.lateFeeAccrued).to.equal(0n);
    expect(l.remainingPrincipal).to.equal(remaining2);
    expect(tokenBalance(env, collateral)).to.equal(2n * inst);
    expect(tokenBalance(env, pool.vault) - vault0).to.equal(split.lateFee + poolInt + split.principal);
    expect(tokenBalance(env, pool.reserve) - reserve0).to.equal(resInt);
    expect(tokenBalance(env, pool.platformTreasury) - platform0).to.equal(platInt);
    expect(p.idleCash - p0.idleCash).to.equal(split.lateFee + poolInt + split.principal);
    expect(p.reserveBalance - p0.reserveBalance).to.equal(resInt);
    expect(p0.totalOutstanding - p.totalOutstanding).to.equal(split.principal);
    expect(p.lateDefaultPrincipal).to.equal(remaining2);
    expect(l.provisionAmount).to.equal(ceilBps(remaining2, 1500));
    expect(p.lossProvision).to.equal(l.provisionAmount);

    // ---- Defaulted ----
    warp(env, 60);
    await crank(c);
    l = readLoan(env, c.loan);
    p = readPool(env, pool.pool);
    const accrued = loanMath.interestForPeriod(remaining2, l0.rateBps) * 3n;
    const value = l0.price < l0.appraisedValue ? l0.price : l0.appraisedValue;
    const expectedLoss = remaining2 + accrued - 2n * inst - floorBps(value, 6300);
    const target = max(ceilBps(remaining2, 1500), expectedLoss > 0n ? expectedLoss : 0n);
    expect(l.status).to.equal(LoanStatus.Defaulted);
    expect(l.missedInstallments).to.equal(3);
    expect(l.lastProcessedPeriod).to.equal(3n);
    expect(l.provisionAmount).to.equal(target);
    expect(p.lossProvision).to.equal(target);
    expect(p.lateDefaultPrincipal).to.equal(remaining2);
    expect(tokenBalance(env, collateral)).to.equal(2n * inst); // ikinci kesinti yok

    // Defaulted sonrası crank yok; record_recovery'nin işi.
    warp(env, 600);
    await crankFails(c, "LoanNotServiceable");
  });

  it("üç dönem birden kaçırılınca tek crank Defaulted'a götürür (teminattan tek kesinti)", async () => {
    const c = activeHouseLoan();
    const inst = readLoan(c.env, c.loan).installment;
    warp(c.env, 60 + 10 + 2 * 60);
    await crank(c);
    const l = readLoan(c.env, c.loan);
    expect(l.status).to.equal(LoanStatus.Defaulted);
    expect(l.lastProcessedPeriod).to.equal(3n);
    expect(l.lateFeeAccrued).to.equal(0n); // gecikme bedeli teminattan ödendi
    expect(tokenBalance(c.env, loanPdas(c.env.programId, c.pool.pool, l.id).collateral)).to.equal(2n * inst);
    await crankFails(c, "LoanNotServiceable");
  });

  it("teminata bağış kesintiyi büyütmez; fazlalık borçluda kalır", async () => {
    const c = activeHouseLoan();
    const l0 = readLoan(c.env, c.loan);
    const { collateral } = loanPdas(c.env.programId, c.pool.pool, l0.id);
    const donation = 5n * USDC;
    writeTokenAccount(c.env, collateral, c.env.usdcMint, c.pool.pool, 3n * l0.installment + donation);
    warp(c.env, 60 + 10 + 60);
    await crank(c);
    expect(tokenBalance(c.env, collateral)).to.equal(2n * l0.installment + donation);
  });

  it("araç havuzunda katsayı 0,54 ile Defaulted karşılığı", async () => {
    const env = setupEnv();
    const pool = createPool(env, VEHICLE_PARAMS, { liquidity: 200_000n * USDC, firstLoss: 10_000n * USDC });
    const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Active });
    const l0 = readLoan(env, loan);
    expect(l0.principal).to.equal(12_000n * USDC);
    warp(env, 60 + 10 + 2 * 60);
    const c = { env, pool, loan };
    await crank(c);
    const l = readLoan(env, loan);
    const accrued = loanMath.interestForPeriod(l.remainingPrincipal, 900) * 3n;
    const expectedLoss = l.remainingPrincipal + accrued - 2n * l0.installment - floorBps(20_000n * USDC, 5400);
    expect(l.provisionAmount).to.equal(max(ceilBps(l.remainingPrincipal, 1500), expectedLoss));
  });

  it("başka havuzun kredisiyle çağrılamaz", async () => {
    const c = activeHouseLoan();
    const other = createPool(c.env, { ...HOUSE_PARAMS, poolId: 9n }, { liquidity: 1_000n * USDC });
    warp(c.env, 60 + 10);
    const s = c.env.wallets.stranger;
    const ix = await crankLoanIx(c.env, other, c.loan, s.publicKey);
    expectTxFail(c.env, [ix], [s], "Error");
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Active);
  });

  it("gecikme freni: crank sonrası yeni kredi fonlanamaz (BrakeLateRatio)", async () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, {
      liquidity: 2_000_000n * USDC,
      firstLoss: 100_000n * USDC,
      reserve: 5_000n * USDC,
    });
    // 4 aktif kredi: 280.000 outstanding
    const active = [0, 1, 2, 3].map(() => writeLoanFixture(env, pool, { status: LoanStatus.Active }).loan);
    const approvedA = writeLoanFixture(env, pool, { status: LoanStatus.Approved }).loan;
    const approvedB = writeLoanFixture(env, pool, { status: LoanStatus.Approved }).loan;
    const s = env.wallets.stranger;

    // Fren yokken fonlama geçer.
    sendTx(env, [await fundLoanIx(env, pool, approvedA)], [s]);
    expect(readLoan(env, approvedA).status).to.equal(LoanStatus.Funded);

    // Bir kredi gecikir: 70.000 / 350.000 = %20 > %10.
    warp(env, 60 + 10);
    sendTx(env, [await crankLoanIx(env, pool, active[0])], [s]);
    const p = readPool(env, pool.pool);
    expect(p.lateDefaultPrincipal).to.equal(70_000n * USDC);

    expectTxFail(env, [await fundLoanIx(env, pool, approvedB)], [s], "BrakeLateRatio");
    expect(readLoan(env, approvedB).status).to.equal(LoanStatus.Approved);
    assertInvariants(env, pool, [...active, approvedA, approvedB]);
  });
});
