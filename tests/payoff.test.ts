import { expect } from "chai";
import { PublicKey } from "@solana/web3.js";
import {
  assertInvariants,
  crankLoanIx,
  createPool,
  expectTxFail,
  fundUsdc,
  HOUSE_PARAMS,
  loanMath,
  loanPdas,
  LoanStatus,
  PoolHandle,
  payoffIx,
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
  writeTokenAccount,
} from "./helpers";

interface Ctx {
  env: TestEnv;
  pool: PoolHandle;
  loan: PublicKey;
}

function setup(status = LoanStatus.Active, opts: { remainingPrincipal?: bigint; collateral?: bigint } = {}): Ctx {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {
    liquidity: 1_000_000n * USDC,
    firstLoss: 50_000n * USDC,
    reserve: 1_000n * USDC,
  });
  const { loan } = writeLoanFixture(env, pool, { status, ...opts });
  fundUsdc(env, env.wallets.borrower1.publicKey, 100_000n * USDC);
  return { env, pool, loan };
}

const borrowerUsdc = (c: Ctx) => tokenBalance(c.env, usdcAta(c.env, c.env.wallets.borrower1.publicKey));
const collateralOf = (c: Ctx) => loanPdas(c.env.programId, c.pool.pool, readLoan(c.env, c.loan).id).collateral;

async function payoff(c: Ctx) {
  const b = c.env.wallets.borrower1;
  sendTx(c.env, [await payoffIx(c.env, c.pool, c.loan, b.publicKey)], [b]);
  assertInvariants(c.env, c.pool, [c.loan]);
}

async function payoffFails(c: Ctx, expected: string) {
  const b = c.env.wallets.borrower1;
  expectTxFail(c.env, [await payoffIx(c.env, c.pool, c.loan, b.publicKey)], [b], expected);
}

describe("payoff", () => {
  it("Active kredi: kalan + bir dönem faizi ödenir, PaidOff, teminat iade edilir", async () => {
    const c = setup();
    const { env, pool } = c;
    const l0 = readLoan(env, c.loan);
    const p0 = readPool(env, pool.pool);
    const vault0 = tokenBalance(env, pool.vault);
    const reserve0 = tokenBalance(env, pool.reserve);
    const plat0 = tokenBalance(env, pool.platformTreasury);
    const usdc0 = borrowerUsdc(c);
    const collateral0 = tokenBalance(env, collateralOf(c));
    expect(collateral0).to.equal(3n * l0.installment);

    await payoff(c);

    const amount = loanMath.finalInstallment(l0.remainingPrincipal, l0.rateBps);
    const interest = loanMath.interestForPeriod(l0.remainingPrincipal, l0.rateBps);
    const [poolInt, platInt, resInt] = loanMath.splitInterest(interest, l0.rateBps);
    const l = readLoan(env, c.loan);
    const p = readPool(env, pool.pool);
    expect(l.status).to.equal(LoanStatus.PaidOff);
    expect(l.remainingPrincipal).to.equal(0n);
    expect(usdc0 - borrowerUsdc(c)).to.equal(amount - collateral0); // ödedi, teminatı geri aldı
    expect(tokenBalance(env, collateralOf(c))).to.equal(0n);
    expect(tokenBalance(env, pool.vault) - vault0).to.equal(l0.remainingPrincipal + poolInt);
    expect(tokenBalance(env, pool.reserve) - reserve0).to.equal(resInt);
    expect(tokenBalance(env, pool.platformTreasury) - plat0).to.equal(platInt);
    expect(p0.totalOutstanding - p.totalOutstanding).to.equal(l0.remainingPrincipal);

    // İkinci kez: ödenecek ve iade edilecek bir şey yok.
    await payoffFails(c, "LoanNotServiceable");
  });

  it("repay'in son taksidiyle PaidOff olan kredi: yalnızca teminat iade edilir", async () => {
    const c = setup(LoanStatus.Active, { remainingPrincipal: 300n * USDC });
    const l0 = readLoan(c.env, c.loan);
    const b = c.env.wallets.borrower1;
    const final = loanMath.finalInstallment(l0.remainingPrincipal, l0.rateBps);
    sendTx(c.env, [await repayIx(c.env, c.pool, c.loan, final, b.publicKey)], [b]);
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.PaidOff);

    const usdc0 = borrowerUsdc(c);
    const vault0 = tokenBalance(c.env, c.pool.vault);
    await payoff(c);
    expect(borrowerUsdc(c) - usdc0).to.equal(3n * l0.installment);
    expect(tokenBalance(c.env, c.pool.vault)).to.equal(vault0);
  });

  it("Recovered kredide kalan teminat ve bağış fazlalığı borçluya döner", async () => {
    const c = setup(LoanStatus.Recovered, { remainingPrincipal: 0n, collateral: 0n });
    writeTokenAccount(c.env, collateralOf(c), c.env.usdcMint, c.pool.pool, 123n * USDC);
    const usdc0 = borrowerUsdc(c);
    await payoff(c);
    expect(borrowerUsdc(c) - usdc0).to.equal(123n * USDC);
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Recovered);
  });

  it("gecikmedeki kredi payoff ile kapatılamaz (önce repay)", async () => {
    const c = setup();
    warp(c.env, 70);
    const s = c.env.wallets.stranger;
    sendTx(c.env, [await crankLoanIx(c.env, c.pool, c.loan)], [s]);
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Late1);
    await payoffFails(c, "LoanNotServiceable");
  });

  it("yalnızca borçlu çağırabilir", async () => {
    const c = setup();
    const s = c.env.wallets.stranger;
    fundUsdc(c.env, s.publicKey, 100_000n * USDC);
    expectTxFail(c.env, [await payoffIx(c.env, c.pool, c.loan, s.publicKey)], [s], "Unauthorized");
    expect(readLoan(c.env, c.loan).status).to.equal(LoanStatus.Active);
  });
});
