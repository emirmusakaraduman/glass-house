import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  assertInvariants,
  createPool,
  depositIx,
  ensureShareAta,
  expectTxFail,
  fundUsdc,
  HOUSE_PARAMS,
  loanMath,
  mintSupply,
  patchPool,
  pendingWithdrawals,
  PoolHandle,
  processWithdrawalsIx,
  readPool,
  readWithdrawRequest,
  requestWithdrawIx,
  sendTx,
  setupEnv,
  shareEscrowPda,
  TestEnv,
  tokenBalance,
  USDC,
  usdcAta,
  withdrawRequestPda,
  writeTokenAccount,
} from "./helpers";

interface Ctx {
  env: TestEnv;
  pool: PoolHandle;
}

/** Gerçek deposit ile iki yatırımcı: investor1 1.000, investor2 500 USDC. */
async function setup(): Promise<Ctx> {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, { firstLoss: 10_000n * USDC, reserve: 1_000n * USDC });
  for (const [kp, amt] of [
    [env.wallets.investor1, 1_000n * USDC],
    [env.wallets.investor2, 500n * USDC],
  ] as [Keypair, bigint][]) {
    fundUsdc(env, kp.publicKey, amt);
    sendTx(env, [await depositIx(env, pool, kp.publicKey, amt)], [kp]);
  }
  assertInvariants(env, pool);
  return { env, pool };
}

const shares = (c: Ctx, owner: Keypair) => tokenBalance(c.env, ensureShareAta(c.env, c.pool, owner.publicKey));
const usdc = (c: Ctx, owner: Keypair) => tokenBalance(c.env, usdcAta(c.env, owner.publicKey));

async function request(c: Ctx, owner: Keypair, amount: bigint) {
  sendTx(c.env, [await requestWithdrawIx(c.env, c.pool, owner.publicKey, amount)], [owner]);
  assertInvariants(c.env, c.pool);
}

async function processAll(c: Ctx) {
  const s = c.env.wallets.stranger;
  sendTx(c.env, [await processWithdrawalsIx(c.env, c.pool)], [s]);
  assertInvariants(c.env, c.pool);
}

/** Zincirin kullanacağı fiyat: işlem anındaki senior NAV. */
function quote(c: Ctx, sh: bigint) {
  const p = readPool(c.env, c.pool.pool);
  const nav = loanMath.seniorNav(p);
  return loanMath.withdrawQuote(sh, p.entryExitFeeBps, p.totalShares, nav);
}

describe("request_withdraw / process_withdrawals", () => {
  it("talep payları kilitler, işlem NAV ile öder, payları yakar ve talebi kapatır", async () => {
    const c = await setup();
    const { env, pool } = c;
    const inv = env.wallets.investor1;
    const sh0 = shares(c, inv);
    const req = sh0 / 2n;

    await request(c, inv, req);
    const wreq = withdrawRequestPda(env.programId, pool.pool, 0n);
    const r = readWithdrawRequest(env, wreq)!;
    expect(r.owner.equals(inv.publicKey)).to.equal(true);
    expect(r.shares).to.equal(req);
    expect(r.seq).to.equal(0n);
    expect(shares(c, inv)).to.equal(sh0 - req);
    expect(tokenBalance(env, shareEscrowPda(env, pool))).to.equal(req);
    expect(readPool(env, pool.pool).withdrawTail).to.equal(1n);

    const p0 = readPool(env, pool.pool);
    const { gross, fee, net } = quote(c, req);
    const usdc0 = usdc(c, inv);
    const supply0 = mintSupply(env, pool.shareMint);
    const lamports0 = env.svm.getBalance(inv.publicKey) ?? 0n;

    await processAll(c);

    const p = readPool(env, pool.pool);
    expect(usdc(c, inv) - usdc0).to.equal(net);
    expect(gross - fee).to.equal(net);
    expect(p0.idleCash - p.idleCash).to.equal(net); // ücret havuzda kalır
    expect(p0.totalShares - p.totalShares).to.equal(req);
    expect(supply0 - mintSupply(env, pool.shareMint)).to.equal(req);
    expect(tokenBalance(env, shareEscrowPda(env, pool))).to.equal(0n);
    expect(p.withdrawHead).to.equal(1n);
    expect(readWithdrawRequest(env, wreq)).to.equal(null);
    expect((env.svm.getBalance(inv.publicKey) ?? 0n) > lamports0).to.equal(true); // kira iadesi
  });

  it("FIFO, işlem başına en fazla 3 talep", async () => {
    const c = await setup();
    const [a, b] = [c.env.wallets.investor1, c.env.wallets.investor2];
    await request(c, a, 100n * USDC);
    await request(c, b, 100n * USDC);
    await request(c, a, 100n * USDC);
    await request(c, b, 100n * USDC);
    expect(pendingWithdrawals(c.env, c.pool, 10)).to.have.length(4);

    await processAll(c);
    let p = readPool(c.env, c.pool.pool);
    expect(p.withdrawHead).to.equal(3n);
    expect(readWithdrawRequest(c.env, withdrawRequestPda(c.env.programId, c.pool.pool, 3n))).to.not.equal(null);

    // 4 talep tek tx'te verilemez.
    const s = c.env.wallets.stranger;
    await request(c, a, 50n * USDC);
    await request(c, b, 50n * USDC);
    await request(c, a, 50n * USDC);
    const four = pendingWithdrawals(c.env, c.pool, 4);
    expectTxFail(c.env, [await processWithdrawalsIx(c.env, c.pool, four)], [s], "InvalidWithdrawRequest");

    await processAll(c);
    p = readPool(c.env, c.pool.pool);
    expect(p.withdrawHead).to.equal(6n);
  });

  it("ödeme talep anındaki değil işlem anındaki NAV ile (zarar sonradan da paya yansır)", async () => {
    const c = await setup();
    const inv = c.env.wallets.investor1;
    const req = shares(c, inv);
    await request(c, inv, req);
    const { net: netAtRequest } = quote(c, req);

    // Bir kredi gecikmeye düştü gibi: karşılık kasa + yedeği 300 USDC aşıyor.
    const p = readPool(c.env, c.pool.pool);
    patchPool(c.env, c.pool.pool, { lossProvision: p.firstLossBalance + p.reserveBalance + 300n * USDC });
    const { net: netNow } = quote(c, req);
    expect(netNow < netAtRequest).to.equal(true);

    const usdc0 = usdc(c, inv);
    await processAll(c);
    expect(usdc(c, inv) - usdc0).to.equal(netNow);
  });

  it("nakit yetmezse durur (InsufficientIdleCash); talep sırada kalır", async () => {
    const c = await setup();
    const inv = c.env.wallets.investor1;
    await request(c, inv, shares(c, inv));
    // Nakdin çoğu krediye verilmiş gibi: idle 100 USDC.
    patchPool(c.env, c.pool.pool, { idleCash: 100n * USDC, totalOutstanding: readPool(c.env, c.pool.pool).idleCash - 100n * USDC });
    writeTokenAccount(c.env, c.pool.vault, c.env.usdcMint, c.pool.pool, 100n * USDC);
    const s = c.env.wallets.stranger;
    expectTxFail(c.env, [await processWithdrawalsIx(c.env, c.pool)], [s], "InsufficientIdleCash");
    expect(readPool(c.env, c.pool.pool).withdrawHead).to.equal(0n);
  });

  it("ödeme hesabı kapatılmış talep atlanır, sonraki talep aynı tx'te işlenir", async () => {
    const c = await setup();
    const { env, pool } = c;
    const [a, b] = [env.wallets.investor1, env.wallets.investor2];
    await request(c, a, 100n * USDC);
    await request(c, b, 100n * USDC);
    // a, USDC hesabını kapattı.
    const destA = usdcAta(env, a.publicKey);
    const entries = pendingWithdrawals(env, pool);
    env.svm.setAccount(destA, { lamports: 0, data: new Uint8Array(), owner: PublicKey.default, executable: false });

    const usdcB0 = usdc(c, b);
    await processAll(c);

    const p = readPool(env, pool.pool);
    expect(p.withdrawHead).to.equal(2n);
    expect(usdc(c, b) > usdcB0).to.equal(true);
    // a'nın talebi açık, payları kilitli.
    expect(readWithdrawRequest(env, entries[0].request)).to.not.equal(null);
    expect(tokenBalance(env, shareEscrowPda(env, pool))).to.equal(100n * USDC);
  });

  it("yanlış hesaplar, boş kuyruk ve sıfır pay reddedilir", async () => {
    const c = await setup();
    const { env, pool } = c;
    const s = env.wallets.stranger;
    const inv = env.wallets.investor1;

    // Hiç talep açılmamış havuz: share_escrow henüz yok, Anchor hesap kontrolünde reddeder.
    const bogus = [{ request: s.publicKey, destination: s.publicKey, owner: s.publicKey }];
    expectTxFail(env, [await processWithdrawalsIx(env, pool, bogus)], [s], "AccountNotInitialized");
    expectTxFail(env, [await requestWithdrawIx(env, pool, inv.publicKey, 0n)], [inv], "ZeroAmount");

    await request(c, inv, 100n * USDC);
    const [e] = pendingWithdrawals(env, pool);
    // Talep sahibi yerine başkası (kira iadesi çalınamaz).
    expectTxFail(
      env,
      [await processWithdrawalsIx(env, pool, [{ ...e, owner: s.publicKey }])],
      [s],
      "InvalidWithdrawRequest",
    );
    // Ödeme başka hesaba yönlendirilemez.
    const other = usdcAta(env, s.publicKey);
    fundUsdc(env, s.publicKey, 0n);
    expectTxFail(
      env,
      [await processWithdrawalsIx(env, pool, [{ ...e, destination: other }])],
      [s],
      "InvalidWithdrawRequest",
    );
    expect(readPool(env, pool.pool).withdrawHead).to.equal(0n);

    // Kuyruk işlenip boşalınca: WithdrawQueueEmpty.
    await processAll(c);
    expectTxFail(env, [await processWithdrawalsIx(env, pool, bogus)], [s], "WithdrawQueueEmpty");
  });
});
