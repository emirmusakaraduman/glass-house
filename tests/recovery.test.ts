// record_recovery testleri (fixture ile): zarar sırası teminat → satış geliri → ilk zarar kasası
// → yedek → senior. Senaryolar: yalnızca kasa, kasa + yedek, senior'a ulaşan zarar; düşük gelirde
// ikinci imza; event. Her adımda assertInvariants.

import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { decodeEvent, RECOVERY_RECORDED } from "./lib/events";
import {
  assertInvariants,
  collateralDeducted,
  crankLoanIx,
  createPool,
  CreatePoolOptions,
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
  recordRecoveryIx,
  sendTx,
  setupEnv,
  TestEnv,
  tokenBalance,
  USDC,
  usdcAta,
  warp,
  waterfall,
  writeLoanFixture,
} from "./helpers";

interface Ctx {
  env: TestEnv;
  pool: PoolHandle;
  loan: PublicKey;
}

function defaultedLoan(poolOpts: CreatePoolOptions = {}): Ctx {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {
    liquidity: 1_000_000n * USDC,
    firstLoss: 50_000n * USDC,
    reserve: 2_000n * USDC,
    ...poolOpts,
  });
  const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Defaulted });
  fundUsdc(env, env.recoveryAgent.publicKey, 200_000n * USDC);
  warp(env, 12 * 60); // satış 12 ay sürdü
  return { env, pool, loan };
}

const nav = (env: TestEnv, pool: PoolHandle) => {
  const p = readPool(env, pool.pool);
  return loanMath.seniorNav({
    idleCash: p.idleCash,
    totalOutstanding: p.totalOutstanding,
    lossProvision: p.lossProvision,
    firstLossBalance: p.firstLossBalance,
    reserveBalance: p.reserveBalance,
  });
};

/** Zincirin kullanacağı zarar sırası girdileri (record_recovery ile aynı formül). */
function expectedWaterfall(c: Ctx, proceeds: bigint) {
  const l = readLoan(c.env, c.loan);
  const p = readPool(c.env, c.pool.pool);
  const late = getUnixTimestamp(c.env) - l.nextDue - p.graceSeconds;
  const periods = late < 0n ? 0n : late / p.periodSeconds + 1n;
  const accruedInterest = loanMath.interestForPeriod(l.remainingPrincipal, l.rateBps) * periods;
  return {
    accruedInterest,
    w: waterfall({
      remainingPrincipal: l.remainingPrincipal,
      accruedInterest,
      lateFees: l.lateFeeAccrued,
      collateral: 3n * l.installment - collateralDeducted(l),
      proceeds,
      firstLossAvailable: p.firstLossBalance,
      reserveAvailable: p.reserveBalance,
    }),
  };
}


async function recover(c: Ctx, proceeds: bigint, coSigner?: Keypair) {
  const agent = c.env.recoveryAgent;
  const ix = await recordRecoveryIx(c.env, c.pool, c.loan, proceeds, { coSigner: coSigner?.publicKey ?? null });
  sendTx(c.env, [ix], coSigner ? [agent, coSigner] : [agent]);
  assertInvariants(c.env, c.pool, [c.loan]);
}

describe("record_recovery", () => {
  it("%30 düşüş (63.000 net): zarar ilk zarar kasasından, yatırımcıya 0; NAV faiz kadar artar", async () => {
    const c = defaultedLoan();
    const { env, pool } = c;
    const l0 = readLoan(env, c.loan);
    const p0 = readPool(env, pool.pool);
    const nav0 = nav(env, pool);
    const agent0 = tokenBalance(env, usdcAta(env, env.recoveryAgent.publicKey));
    const vault0 = tokenBalance(env, pool.vault);
    const proceeds = 63_000n * USDC;
    const { accruedInterest, w } = expectedWaterfall(c, proceeds);
    expect(w.seniorLoss).to.equal(0n);
    expect(w.loss > 0n).to.equal(true);

    await recover(c, proceeds);

    const l = readLoan(env, c.loan);
    const p = readPool(env, pool.pool);
    expect(l.status).to.equal(LoanStatus.Recovered);
    expect(l.remainingPrincipal).to.equal(0n);
    expect(l.provisionAmount).to.equal(0n);
    expect(agent0 - tokenBalance(env, usdcAta(env, env.recoveryAgent.publicKey))).to.equal(w.proceedsUsed);
    const into = w.collateralUsed + w.proceedsUsed + w.firstLossUsed + w.reserveUsed;
    expect(tokenBalance(env, pool.vault) - vault0).to.equal(into);
    expect(p.idleCash - p0.idleCash).to.equal(into);
    expect(p0.totalOutstanding - p.totalOutstanding).to.equal(l0.remainingPrincipal);
    expect(p.lateDefaultPrincipal).to.equal(0n);
    expect(p.lossProvision).to.equal(0n);
    expect(p0.firstLossBalance - p.firstLossBalance).to.equal(w.firstLossUsed);
    expect(tokenBalance(env, pool.firstLoss)).to.equal(p.firstLossBalance);
    expect(nav(env, pool) - nav0).to.equal(accruedInterest);
    const { collateral } = loanPdas(env.programId, pool.pool, l.id);
    expect(tokenBalance(env, collateral)).to.equal(0n);
  });

  it("kasa ve yedek yetmezse kalan zarar yatırımcıya yansır", async () => {
    const c = defaultedLoan({ firstLoss: 1_000n * USDC, reserve: 500n * USDC });
    const nav0 = nav(c.env, c.pool);
    // Kurtarmadan önce karşılığın kasa + yedeği aşan kısmı NAV'dan zaten düşülmüştü.
    const p0 = readPool(c.env, c.pool.pool);
    const shortfall0 = p0.lossProvision - p0.firstLossBalance - p0.reserveBalance;
    expect(shortfall0 > 0n).to.equal(true);
    const { accruedInterest, w } = expectedWaterfall(c, 50_000n * USDC);
    expect(w.seniorLoss > 0n).to.equal(true);
    await recover(c, 50_000n * USDC);
    const p = readPool(c.env, c.pool.pool);
    expect(p.firstLossBalance).to.equal(0n);
    expect(p.reserveBalance).to.equal(0n);
    // Gerçek zarar artık bakiyelerde: karşılık kapanır, beklenen açık NAV'a geri döner.
    expect(nav(c.env, c.pool) - nav0).to.equal(accruedInterest - w.seniorLoss + shortfall0);
  });

  it("alt sınırın altında: ikinci imza yoksa RecoveryBelowFloor, yanlış imzacı InvalidCoSigner, admin ile geçer", async () => {
    const c = defaultedLoan();
    const { env, pool } = c;
    const agent = env.recoveryAgent;
    const low = 40_000n * USDC; // taban = 100.000 × %50 = 50.000

    expectTxFail(env, [await recordRecoveryIx(env, pool, c.loan, low)], [agent], "RecoveryBelowFloor");
    const s = env.wallets.stranger;
    expectTxFail(
      env,
      [await recordRecoveryIx(env, pool, c.loan, low, { coSigner: s.publicKey })],
      [agent, s],
      "InvalidCoSigner",
    );
    expect(readLoan(env, c.loan).status).to.equal(LoanStatus.Defaulted);

    await recover(c, low, env.wallets.platform);
    expect(readLoan(env, c.loan).status).to.equal(LoanStatus.Recovered);
  });

  it("yalnızca recovery_agent çağırabilir", async () => {
    const c = defaultedLoan();
    const s = c.env.wallets.stranger;
    fundUsdc(c.env, s.publicKey, 100_000n * USDC);
    const ix = await recordRecoveryIx(c.env, c.pool, c.loan, 63_000n * USDC, { recoveryAgent: s.publicKey });
    expectTxFail(c.env, [ix], [s], "Unauthorized");
  });

  it("yalnızca Defaulted kredide; ikinci kez çağrılamaz", async () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 100_000n * USDC, firstLoss: 10_000n * USDC });
    const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Late2 });
    fundUsdc(env, env.recoveryAgent.publicKey, 100_000n * USDC);
    const a = env.recoveryAgent;
    expectTxFail(env, [await recordRecoveryIx(env, pool, loan, 63_000n * USDC)], [a], "LoanNotServiceable");

    const c = defaultedLoan();
    await recover(c, 63_000n * USDC);
    expectTxFail(
      c.env,
      [await recordRecoveryIx(c.env, c.pool, c.loan, 63_000n * USDC)],
      [c.env.recoveryAgent],
      "LoanNotServiceable",
    );
  });

  it("alacaktan fazla gelir çekilmez", async () => {
    const c = defaultedLoan();
    const agent0 = tokenBalance(c.env, usdcAta(c.env, c.env.recoveryAgent.publicKey));
    const { w } = expectedWaterfall(c, 150_000n * USDC);
    expect(w.loss).to.equal(0n);
    await recover(c, 150_000n * USDC);
    expect(agent0 - tokenBalance(c.env, usdcAta(c.env, c.env.recoveryAgent.publicKey))).to.equal(w.proceedsUsed);
    expect(w.proceedsUsed < 150_000n * USDC).to.equal(true);
  });

  it("uçtan uca: Active → crank → Defaulted → satış → Recovered", async () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, {
      liquidity: 1_000_000n * USDC,
      firstLoss: 50_000n * USDC,
      reserve: 2_000n * USDC,
    });
    const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Active });
    fundUsdc(env, env.recoveryAgent.publicKey, 100_000n * USDC);
    const s = env.wallets.stranger;
    warp(env, 70 + 2 * 60);
    sendTx(env, [await crankLoanIx(env, pool, loan)], [s]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Defaulted);
    warp(env, 12 * 60);
    const c = { env, pool, loan };
    const { w } = expectedWaterfall(c, 63_000n * USDC);
    await recover(c, 63_000n * USDC);
    const p = readPool(env, pool.pool);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Recovered);
    expect(p.totalOutstanding).to.equal(0n);
    expect(p.lossProvision).to.equal(0n);
    expect(p.lateDefaultPrincipal).to.equal(0n);
    expect(w.seniorLoss).to.equal(0n);
  });

  it("zarar FirstLossVault'u ve Reserve'in bir kısmını yer, senior'a ulaşmaz", async () => {
    // Önce zararı ölç, sonra kasayı zararın yarısı, yedeği zarara yetecek kadar kur.
    const probe = defaultedLoan();
    const { w: probeW } = expectedWaterfall(probe, 63_000n * USDC);
    const loss = probeW.loss;
    expect(loss > 1n).to.equal(true);
    const firstLoss = loss / 2n;
    const reserve = loss;

    const c = defaultedLoan({ firstLoss, reserve });
    const p0 = readPool(c.env, c.pool.pool);
    const { w } = expectedWaterfall(c, 63_000n * USDC);
    expect(w.firstLossUsed).to.equal(firstLoss); // kasa tamamen biter
    expect(w.reserveUsed).to.equal(loss - firstLoss); // yedek kısmen
    expect(w.reserveUsed > 0n && w.reserveUsed < reserve).to.equal(true);
    expect(w.seniorLoss).to.equal(0n);

    await recover(c, 63_000n * USDC);

    const p = readPool(c.env, c.pool.pool);
    expect(p.firstLossBalance).to.equal(0n);
    expect(p0.reserveBalance - p.reserveBalance).to.equal(loss - firstLoss);
    expect(p.reserveBalance).to.equal(reserve - (loss - firstLoss));
    expect(tokenBalance(c.env, c.pool.firstLoss)).to.equal(0n);
    expect(tokenBalance(c.env, c.pool.reserve)).to.equal(p.reserveBalance);
    expect(p.lossProvision).to.equal(0n);
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Recovered);
  });

  it("RecoveryRecorded event'i: gelir, zarar ve kasa/yedek/senior paylarını bildirir", async () => {
    const c = defaultedLoan({ firstLoss: 1_000n * USDC, reserve: 500n * USDC });
    const agent = c.env.recoveryAgent;
    const { w } = expectedWaterfall(c, 50_000n * USDC);
    const res = sendTx(
      c.env,
      [await recordRecoveryIx(c.env, c.pool, c.loan, 50_000n * USDC)],
      [agent],
    );
    assertInvariants(c.env, c.pool, [c.loan]);

    const d = decodeEvent(c.env, res.logs(), "RecoveryRecorded", RECOVERY_RECORDED);
    expect(d.pool.toBase58()).to.equal(c.pool.pool.toBase58());
    expect(d.loanId).to.equal(readLoan(c.env, c.loan).id);
    expect(d.proceeds).to.equal(w.proceedsUsed);
    expect(d.collateralUsed).to.equal(w.collateralUsed);
    expect(d.loss).to.equal(w.loss);
    expect(d.firstLossUsed).to.equal(w.firstLossUsed);
    expect(d.reserveUsed).to.equal(w.reserveUsed);
    expect(d.seniorLoss).to.equal(w.seniorLoss);
    // Zarar üç yere bölünür; toplam zarara eşit.
    expect(d.firstLossUsed + d.reserveUsed + d.seniorLoss).to.equal(d.loss);
  });

  it("reddedilen çağrılar (ikinci imza yok, yabancı) hiçbir şeyi değiştirmez; invariant'lar sağlam", async () => {
    const c = defaultedLoan();
    const agent = c.env.recoveryAgent;
    const before = readPool(c.env, c.pool.pool);
    const loanBefore = readLoan(c.env, c.loan);
    const vault0 = tokenBalance(c.env, c.pool.vault);

    expectTxFail(c.env, [await recordRecoveryIx(c.env, c.pool, c.loan, 1n * USDC)], [agent], "RecoveryBelowFloor");
    assertInvariants(c.env, c.pool, [c.loan]);
    const s = c.env.wallets.stranger;
    fundUsdc(c.env, s.publicKey, 100_000n * USDC);
    expectTxFail(
      c.env,
      [await recordRecoveryIx(c.env, c.pool, c.loan, 63_000n * USDC, { recoveryAgent: s.publicKey })],
      [s],
      "Unauthorized",
    );
    assertInvariants(c.env, c.pool, [c.loan]);

    expect(readPool(c.env, c.pool.pool)).to.deep.equal(before);
    expect(readLoan(c.env, c.loan)).to.deep.equal(loanBefore);
    expect(tokenBalance(c.env, c.pool.vault)).to.equal(vault0);
  });
});
