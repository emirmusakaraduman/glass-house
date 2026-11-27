// repay testleri (fixture + gerçek apply_loan). period_seconds = 60, grace_seconds = 10.
// Ödeme sırası: gecikme bedeli → faiz → anapara. Faiz bölüşümü: platform ve yedek yıllık orandan
// 50 bps'er (faiz × 50 / rate_bps, aşağı); küsurat ve kalan havuzda kalır (NAV'ı büyütür).

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { decodeEvent, LOAN_REPAID } from "./lib/events";
import {
  assertInvariants,
  BPS,
  ensureUsdcAta,
  collateralDeducted,
  interestSettled,
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
    expect(interestSettled(l) > 0n).to.equal(true); // teminattan ödenen faiz kaydedildi

    await pay(c, inst); // bir dönem kapanır, hâlâ bir vade geçmiş
    l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Late2);
    expect(l.lastProcessedPeriod).to.equal(2n);
    expect(interestSettled(l) > 0n).to.equal(true); // hâlâ aynı gecikme döngüsü
    expect(readPool(env, pool.pool).lateDefaultPrincipal).to.equal(l.remainingPrincipal);
    expect(l.provisionAmount).to.equal(ceilBps(l.remainingPrincipal, 1500));

    await pay(c, inst); // ikinci dönem → Active
    l = readLoan(env, c.loan);
    expect(l.status).to.equal(LoanStatus.Active);
    expect(l.lastProcessedPeriod).to.equal(0n);
    expect(interestSettled(l)).to.equal(0n); // gecikmeden çıkış: yeni döngü temiz başlar
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

// ───────────────────────────── 20 yıllık %7 kredi (70.000 USDC, 240 ay) ─────────────────────────────

/** Bağımsız (BigInt değil, float) annüite: M = P·r·x / (x − 1), r = yıllık/12, x = (1 + r)^n. */
function floatInstallment(principal: bigint, annualPct: number, months: number): number {
  const r = annualPct / 100 / 12;
  const x = Math.pow(1 + r, months);
  return (Number(principal) * r * x) / (x - 1);
}

describe("repay: 20 yıllık %7 kredi (240 ay, 70.000 USD)", () => {
  it("zincirdeki taksit (gerçek apply_loan) JS formülüyle ±1 micro-USDC uyumlu", async () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 50_000n * USDC });
    const { borrower1, seller } = env.wallets;
    fundUsdc(env, borrower1.publicKey, 50_000n * USDC);
    ensureUsdcAta(env, seller.publicKey);

    const id = readPool(env, pool.pool).nextLoanId;
    const { loan, escrow, collateral } = loanPdas(env.programId, pool.pool, id);
    const ix = await env
      .program!.methods.applyLoan(new BN((100_000n * USDC).toString()), new BN((30_000n * USDC).toString()))
      .accountsStrict({
        borrower: borrower1.publicKey,
        seller: seller.publicKey,
        pool: pool.pool,
        loan,
        usdcMint: env.usdcMint,
        borrowerUsdc: usdcAta(env, borrower1.publicKey),
        loanEscrow: escrow,
        collateralEscrow: collateral,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    sendTx(env, [ix], [borrower1, seller]);

    const l = readLoan(env, loan);
    expect(l.principal).to.equal(70_000n * USDC);
    expect(l.rateBps).to.equal(700);
    const expected = floatInstallment(70_000n * USDC, 7, 240);
    expect(Math.abs(Number(l.installment) - expected)).to.be.lessThan(1.0001);
    expect(Number(l.installment) / 1e6).to.be.closeTo(542.71, 0.01); // belge: Maria 542,71
    // İlk ay faizi: 70.000 × 0,07 / 12 = 408,333…
    const interest1 = Number(loanMath.interestForPeriod(l.principal, 700));
    expect(Math.abs(interest1 - (Number(l.principal) * 0.07) / 12)).to.be.lessThan(1.0001);
    // Teminat: 3 taksit.
    expect(tokenBalance(env, collateral)).to.equal(3n * l.installment);
  });

  it("240 taksitle tam amortisman: her adım loanMath ile birebir, kalan anapara TAM sıfır, PaidOff", async () => {
    const c = setup({});
    fundUsdc(c.env, c.env.wallets.borrower1.publicKey, 200_000n * USDC);
    const l0 = readLoan(c.env, c.loan);
    expect(l0.principal).to.equal(70_000n * USDC);

    let remaining = l0.remainingPrincipal;
    let count = 0;
    let totalPaid = 0n;
    let last = 0n;
    while (remaining > 0n) {
      const final = loanMath.finalInstallment(remaining, 700);
      // Son taksit: kalan + dönem faizi (taksitten küçük ya da eşit olabilir); aksi halde sabit taksit.
      const amount = final <= l0.installment ? final : l0.installment;
      const split = loanMath.splitPayment(amount, remaining, 700, 0n);
      await pay(c, amount);
      remaining -= split.principal;
      totalPaid += amount;
      last = amount;
      count++;
      expect(readLoan(c.env, c.loan).remainingPrincipal).to.equal(remaining);
      expect(count).to.be.lessThan(300); // sonsuz döngü koruması
    }
    const l = readLoan(c.env, c.loan);
    expect(l.status).to.equal(LoanStatus.PaidOff);
    expect(l.remainingPrincipal).to.equal(0n);
    expect(l.paidInstallments).to.equal(count);
    expect(readPool(c.env, c.pool.pool).totalOutstanding).to.equal(0n);
    // Her ay faiz yukarı yuvarlandığı için 240 taksitten sonra birkaç micro-USDC kalabilir; bu durumda
    // 241. ödeme yalnızca bu tozdur. İkisi de geçerli: kalan anapara yine tam sıfırlanır.
    expect(count).to.be.within(240, 241);
    if (count === 241) expect(Number(last)).to.be.lessThan(1_000);
    // Toplam ödeme ≈ 240 × M (yuvarlama payı: taksit başına en fazla 1 micro).
    expect(Number(totalPaid - 240n * l0.installment)).to.be.within(-300, 1_000);
  });
});

describe("repay: faiz bölüşümü ve küsurat", () => {
  it("platform ve yedek 50 bps'er; küsurat ve kalan havuza gider (bağımsız formülle)", async () => {
    // Faizi tam bölünmeyen bir kalan anapara.
    const c = setup({ remainingPrincipal: 69_999_999_999n });
    const { env, pool } = c;
    const l0 = readLoan(env, c.loan);
    const vault0 = tokenBalance(env, pool.vault);
    const reserve0 = tokenBalance(env, pool.reserve);
    const plat0 = tokenBalance(env, pool.platformTreasury);

    await pay(c, l0.installment);

    const interest = loanMath.interestForPeriod(l0.remainingPrincipal, l0.rateBps);
    const principal = l0.installment - interest;
    const dPlat = tokenBalance(env, pool.platformTreasury) - plat0;
    const dRes = tokenBalance(env, pool.reserve) - reserve0;
    const dVault = tokenBalance(env, pool.vault) - vault0;

    // Bağımsız: platform = faiz × 50 / oran (aşağı), yedek aynı.
    const share = (interest * 50n) / BigInt(l0.rateBps);
    expect(dPlat).to.equal(share);
    expect(dRes).to.equal(share);
    // Havuz payı = faiz − platform − yedek (küsurat dahil) + anapara.
    const poolInterest = interest - dPlat - dRes;
    expect(dVault).to.equal(poolInterest + principal);
    // Ödenen para korunur: havuz + platform + yedek = taksit.
    expect(dVault + dPlat + dRes).to.equal(l0.installment);
    // Havuz payı NAV'a giren tutardır: idle_cash tam o kadar artar (dağıtım yok).
    expect(readPool(env, pool.pool).idleCash - 1_000_000n * USDC).to.equal(dVault);
  });
});

describe("repay: LoanRepaid event'i", () => {
  it("alanlar ödeme sırasını ve yeni durumu bildirir", async () => {
    const c = setup();
    const b = c.env.wallets.borrower1;
    const l0 = readLoan(c.env, c.loan);
    const res = sendTx(c.env, [await repayIx(c.env, c.pool, c.loan, l0.installment, b.publicKey)], [b]);
    assertInvariants(c.env, c.pool, [c.loan]);

    const e = decodeEvent(c.env, res.logs(), "LoanRepaid", LOAN_REPAID);
    const split = loanMath.splitPayment(l0.installment, l0.remainingPrincipal, l0.rateBps, 0n);
    expect(e.pool.toBase58()).to.equal(c.pool.pool.toBase58());
    expect(e.loanId).to.equal(l0.id);
    expect(e.amount).to.equal(l0.installment);
    expect(e.lateFee).to.equal(0n);
    expect(e.interest).to.equal(split.interest);
    expect(e.principal).to.equal(split.principal);
    expect(e.remainingPrincipal).to.equal(l0.remainingPrincipal - split.principal);
    expect(e.status).to.equal(LoanStatus.Active);
    expect(e.nextDue).to.equal(l0.nextDue + 60n);
    expect(e.lateFee + e.interest + e.principal).to.equal(e.amount);
  });

  it("gecikmeden dönüşte gecikme bedeli önce ödenir; Active'e döner, karşılık sıfırlanır", async () => {
    const c = setup();
    const b = c.env.wallets.borrower1;
    warp(c.env, 60 + 10);
    await crank(c); // Late1, gecikme bedeli %2
    const l = readLoan(c.env, c.loan);
    expect(l.lateFeeAccrued > 0n).to.equal(true);
    expect(readPool(c.env, c.pool.pool).lossProvision > 0n).to.equal(true);
    const res = sendTx(
      c.env,
      [await repayIx(c.env, c.pool, c.loan, l.lateFeeAccrued + l.installment, b.publicKey)],
      [b],
    );
    assertInvariants(c.env, c.pool, [c.loan]);
    const e = decodeEvent(c.env, res.logs(), "LoanRepaid", LOAN_REPAID);
    expect(e.lateFee).to.equal(l.lateFeeAccrued); // sıra: gecikme bedeli → faiz → anapara
    expect(e.status).to.equal(LoanStatus.Active);
    expect(readLoan(c.env, c.loan).provisionAmount).to.equal(0n);
    expect(readPool(c.env, c.pool.pool).lossProvision).to.equal(0n);
  });
});
