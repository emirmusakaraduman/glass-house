// deposit testleri (LiteSVM): pay basımı NAV ile, giriş ücreti havuzda kalır, bağış pay fiyatını şişirmez.

import { expect } from "chai";
import {
  assertInvariants,
  createPool,
  depositIx,
  ensureShareAta,
  fundUsdc,
  HOUSE_PARAMS,
  loanMath,
  mintSupply,
  patchPool,
  PoolStatus,
  readPool,
  sendTx,
  setupEnv,
  tokenBalance,
  USDC,
  usdcAta,
  writeTokenAccount,
} from "./helpers";
import { expectAnchorError, failureLogs } from "./lib/ixs";

function setup() {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {}); // boş havuz
  for (const w of [env.wallets.investor1, env.wallets.investor2]) fundUsdc(env, w.publicKey, 100_000n * USDC);
  return { env, pool };
}

const shares = (env: ReturnType<typeof setup>["env"], pool: ReturnType<typeof setup>["pool"], who: any) =>
  tokenBalance(env, ensureShareAta(env, pool, who.publicKey));

describe("deposit", () => {
  it("ilk yatırım: NAV ile pay basılır, giriş ücreti havuzda kalır, sayaçlar ve arz tutarlı", async () => {
    const { env, pool } = setup();
    const inv = env.wallets.investor1;
    const p0 = readPool(env, pool.pool);
    const nav0 = loanMath.seniorNav(p0);
    const q = loanMath.depositQuote(1_000n * USDC, p0.entryExitFeeBps, p0.totalShares, nav0);

    sendTx(env, [await depositIx(env, pool, inv.publicKey, 1_000n * USDC)], [inv]);

    const p = readPool(env, pool.pool);
    expect(shares(env, pool, inv)).to.equal(q.shares);
    expect(q.fee).to.equal(2n * USDC); // %0,2 × 1.000, yukarı yuvarlanmış
    expect(p.idleCash).to.equal(1_000n * USDC); // ücret havuzdan çıkmaz
    expect(tokenBalance(env, pool.vault)).to.equal(1_000n * USDC);
    expect(p.totalShares).to.equal(q.shares);
    expect(mintSupply(env, pool.shareMint)).to.equal(q.shares);
    expect(tokenBalance(env, usdcAta(env, inv.publicKey))).to.equal(99_000n * USDC);
    assertInvariants(env, pool);
  });

  it("ikinci yatırımcı güncel NAV fiyatıyla girer (pay fiyatı değişmez)", async () => {
    const { env, pool } = setup();
    const [a, b] = [env.wallets.investor1, env.wallets.investor2];
    sendTx(env, [await depositIx(env, pool, a.publicKey, 1_000n * USDC)], [a]);
    const p1 = readPool(env, pool.pool);
    const q = loanMath.depositQuote(500n * USDC, p1.entryExitFeeBps, p1.totalShares, loanMath.seniorNav(p1));
    sendTx(env, [await depositIx(env, pool, b.publicKey, 500n * USDC)], [b]);
    expect(shares(env, pool, b)).to.equal(q.shares);
    expect(readPool(env, pool.pool).totalShares).to.equal(p1.totalShares + q.shares);
    assertInvariants(env, pool);
  });

  it("vault'a doğrudan bağış pay fiyatını şişirmez (NAV içsel sayaçtan)", async () => {
    const { env, pool } = setup();
    const [a, b] = [env.wallets.investor1, env.wallets.investor2];
    sendTx(env, [await depositIx(env, pool, a.publicKey, 1_000n * USDC)], [a]);
    const p1 = readPool(env, pool.pool);
    const expected = loanMath.depositQuote(500n * USDC, p1.entryExitFeeBps, p1.totalShares, loanMath.seniorNav(p1));

    // Saldırgan 10.000 USDC'yi imzasız doğrudan vault token hesabına koyar.
    writeTokenAccount(env, pool.vault, env.usdcMint, pool.pool, tokenBalance(env, pool.vault) + 10_000n * USDC);
    expect(readPool(env, pool.pool).idleCash).to.equal(p1.idleCash); // sayaç değişmedi

    sendTx(env, [await depositIx(env, pool, b.publicKey, 500n * USDC)], [b]);
    expect(shares(env, pool, b)).to.equal(expected.shares); // bağışsız fiyatla aynı
    assertInvariants(env, pool); // vault ≥ idle_cash hâlâ sağlanır (fazlalık)
  });

  it("sıfır tutar ve payı 0'a yuvarlanan yatırım reddedilir (ZeroAmount)", async () => {
    const { env, pool } = setup();
    const inv = env.wallets.investor1;
    expectAnchorError(env, [await depositIx(env, pool, inv.publicKey, 0n)], [inv], "ZeroAmount");
    // 1 micro-USDC: ücret yukarı yuvarlanınca net 0 → pay 0.
    expectAnchorError(env, [await depositIx(env, pool, inv.publicKey, 1n)], [inv], "ZeroAmount");
    expect(readPool(env, pool.pool).totalShares).to.equal(0n);
    expect(tokenBalance(env, usdcAta(env, inv.publicKey))).to.equal(100_000n * USDC);
  });

  it("duraklatılmış havuza yatırım yapılamaz (InvalidStatus)", async () => {
    const { env, pool } = setup();
    const inv = env.wallets.investor1;
    patchPool(env, pool.pool, { status: PoolStatus.Paused });
    expectAnchorError(env, [await depositIx(env, pool, inv.publicKey, 1_000n * USDC)], [inv], "InvalidStatus");
  });

  it("yetersiz USDC bakiyesi reddedilir; havuz ve paylar değişmez", async () => {
    const { env, pool } = setup();
    const inv = env.wallets.investor1;
    const logs = failureLogs(env, [await depositIx(env, pool, inv.publicKey, 500_000n * USDC)], [inv]);
    expect(logs).to.match(/insufficient funds|custom program error: 0x1/i);
    expect(readPool(env, pool.pool).totalShares).to.equal(0n);
    assertInvariants(env, pool);
  });
});
