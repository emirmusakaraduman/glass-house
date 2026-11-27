import { expect } from "chai";
import {
  assertInvariants,
  createPool,
  HOUSE_PARAMS,
  LoanStatus,
  patchPool,
  readPool,
  setupEnv,
  tokenBalance,
  USDC,
  VEHICLE_PARAMS,
  writeLoanFixture,
  writeMint,
  writeTokenAccount,
} from "./helpers";

describe("invariants", () => {
  it("yeni havuz invariant'ları sağlar (ev ve araç)", () => {
    const env = setupEnv();
    const house = createPool(env, HOUSE_PARAMS, { liquidity: 1_000_000n * USDC, firstLoss: 50_000n * USDC });
    const car = createPool(env, { ...VEHICLE_PARAMS, poolId: 1n }, { liquidity: 200_000n * USDC });

    const r = assertInvariants(env, house);
    expect(r.vault).to.equal(1_000_000n * USDC);
    expect(r.idleCash).to.equal(1_000_000n * USDC);
    assertInvariants(env, car);
  });

  it("kredi fixture'larıyla invariant'lar sağlanır", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 500_000n * USDC, firstLoss: 35_000n * USDC });
    const loans = [LoanStatus.Pending, LoanStatus.Funded, LoanStatus.Active, LoanStatus.Late2, LoanStatus.Defaulted].map(
      (status) => writeLoanFixture(env, pool, { status }).loan,
    );
    const r = assertInvariants(env, pool, loans);
    expect(r.escrows).to.have.length(5);
  });

  it("vault < idle_cash olunca hata verir", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 100n * USDC });
    patchPool(env, pool.pool, { idleCash: 100n * USDC + 1n });
    expect(() => assertInvariants(env, pool)).to.throw(/vault .* < idle_cash/);
  });

  it("first_loss token < first_loss_balance olunca hata verir", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { firstLoss: 10n * USDC });
    writeTokenAccount(env, pool.firstLoss, env.usdcMint, pool.pool, 9n * USDC);
    expect(() => assertInvariants(env, pool)).to.throw(/first_loss/);
  });

  it("escrow beklenen tutarın altındaysa hata verir, üstündeyse kabul eder (covers, >=)", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 100_000n * USDC });
    const loan = writeLoanFixture(env, pool, { status: LoanStatus.Pending });
    const balance = tokenBalance(env, loan.escrow);

    writeTokenAccount(env, loan.escrow, env.usdcMint, pool.pool, balance + 1n);
    assertInvariants(env, pool, [loan.loan]);

    writeTokenAccount(env, loan.escrow, env.usdcMint, pool.pool, balance - 1n);
    expect(() => assertInvariants(env, pool, [loan.loan])).to.throw(/escrow .* < beklenen/);
    expect(readPool(env, pool.pool).nextLoanId).to.equal(1n);
  });

  it("pay arzı total_shares'ı aşınca hata verir", () => {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, { liquidity: 1_000n * USDC });
    const r = assertInvariants(env, pool);
    expect(r.shareSupply).to.equal(r.totalShares);

    // Çekim sonrası: paylar yakıldı, total_shares düştü → arz ≤ total_shares korunur.
    writeMint(env, pool.shareMint, pool.pool, 400n * USDC);
    patchPool(env, pool.pool, { totalShares: 400n * USDC });
    assertInvariants(env, pool);

    // Hata: total_shares düşürüldü ama paylar yakılmadı.
    patchPool(env, pool.pool, { totalShares: 300n * USDC });
    expect(() => assertInvariants(env, pool)).to.throw(/share supply .* > total_shares/);
  });
});
