// create_pool testleri (LiteSVM): ürün parametreleri kabul edilir, güvenlik aralığı dışı reddedilir,
// parametreler sonradan değişmez. Sınırlar: programs/glasshouse/src/constants.rs (karar 2).

import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  ensureUsdcAta,
  HOUSE_PARAMS,
  MODE_2008_PARAMS,
  PoolParams,
  poolPdas,
  readPool,
  sendTx,
  setupEnv,
  tokenBalance,
  VEHICLE_PARAMS,
  writeMint,
  writeTokenAccount,
} from "./helpers";
import { createPoolIx, expectAnchorError } from "./lib/ixs";

function setup() {
  const env = setupEnv();
  ensureUsdcAta(env, env.wallets.platform.publicKey);
  return env;
}

async function create(env: ReturnType<typeof setup>, p: PoolParams) {
  sendTx(env, [await createPoolIx(env, p)], [env.wallets.platform]);
  return readPool(env, poolPdas(env.programId, env.wallets.platform.publicKey, p.poolId ?? 0n).pool);
}

describe("create_pool", () => {
  it("ev, araç ve 2008 modu parametreleri kabul edilir ve aynen yazılır", async () => {
    const env = setup();
    const house = await create(env, { ...HOUSE_PARAMS, poolId: 1n });
    expect([house.maxLtvBps, house.rateBps, house.termMonths, house.recoveryCoeffBps]).to.deep.equal([7000, 700, 240, 6300]);

    const vehicle = await create(env, { ...VEHICLE_PARAMS, poolId: 2n });
    expect([vehicle.maxLtvBps, vehicle.rateBps, vehicle.termMonths, vehicle.recoveryCoeffBps]).to.deep.equal([6000, 900, 60, 5400]);

    // 2008 modu: aynı program, %97 LTV, ilk zarar şartı 0, yedek freni kapalı.
    const crisis = await create(env, { ...MODE_2008_PARAMS, poolId: 3n, brakeReserveBps: 0 });
    expect(crisis.maxLtvBps).to.equal(9700);
    expect(crisis.minFirstLossBps).to.equal(0);
    expect(crisis.brakeReserveBps).to.equal(0);
  });

  it("token hesapları ve pay mint'i açılır; authority Pool PDA'sıdır; sayaçlar sıfır", async () => {
    const env = setup();
    const p = await create(env, HOUSE_PARAMS);
    const pdas = poolPdas(env.programId, env.wallets.platform.publicKey, 0n);
    for (const a of [pdas.vault, pdas.firstLoss, pdas.reserve]) {
      expect(tokenBalance(env, a)).to.equal(0n);
    }
    expect(env.svm.getAccount(pdas.shareMint)).to.not.equal(null);
    expect([p.idleCash, p.totalOutstanding, p.totalShares, p.nextLoanId, p.firstLossBalance]).to.deep.equal([0n, 0n, 0n, 0n, 0n]);
    expect(p.admin.equals(env.wallets.platform.publicKey)).to.equal(true);
    expect(p.underwriter.equals(env.wallets.underwriter.publicKey)).to.equal(true);
    expect(p.titleAgent.equals(env.wallets.titleAgent.publicKey)).to.equal(true);
    expect(p.recoveryAgent.equals(env.recoveryAgent.publicKey)).to.equal(true);
  });

  const BAD: [string, Partial<PoolParams>][] = [
    ["max_ltv 0", { maxLtvBps: 0 }],
    ["max_ltv > %97", { maxLtvBps: 9701 }],
    ["faiz 0", { rateBps: 0 }],
    ["faiz > %20", { rateBps: 2001 }],
    ["vade 0", { termMonths: 0 }],
    ["vade > 360", { termMonths: 361 }],
    ["recovery_coeff > 10000", { recoveryCoeffBps: 10001 }],
    ["karşılık azalıyor", { provisionBps: [0, 500, 400, 1500] }],
    ["karşılık > 10000", { provisionBps: [0, 500, 1500, 10001] }],
    ["tampon > %50", { bufferBps: 5001 }],
    ["min_first_loss > 10000", { minFirstLossBps: 10001 }],
    ["gecikme freni > 10000", { brakeLateBps: 10001 }],
    ["yedek freni > 10000", { brakeReserveBps: 10001 }],
    ["min_recovery > 10000", { minRecoveryBps: 10001 }],
    ["period 0", { periodSeconds: 0n }],
    ["grace ≥ period", { graceSeconds: 60n }],
    ["grace negatif", { graceSeconds: -1n }],
    ["giriş/çıkış ücreti > %1", { entryExitFeeBps: 101 }],
    ["tescil süresi 0", { titleTimeoutSeconds: 0n }],
  ];
  for (const [name, patch] of BAD) {
    it(`sınır dışı: ${name} → ParamOutOfBounds; havuz oluşmaz`, async () => {
      const env = setup();
      const params = { ...HOUSE_PARAMS, ...patch };
      expectAnchorError(env, [await createPoolIx(env, params)], [env.wallets.platform], "ParamOutOfBounds");
      const { pool } = poolPdas(env.programId, env.wallets.platform.publicKey, 0n);
      expect(env.svm.getAccount(pool)).to.equal(null);
    });
  }

  it("sınırın tam kenarı kabul edilir (LTV %97, faiz %20, vade 360, ücret %1, tampon %50)", async () => {
    const env = setup();
    const p = await create(env, {
      ...HOUSE_PARAMS,
      maxLtvBps: 9700,
      rateBps: 2000,
      termMonths: 360,
      entryExitFeeBps: 100,
      bufferBps: 5000,
    });
    expect([p.maxLtvBps, p.rateBps, p.termMonths, p.entryExitFeeBps, p.bufferBps]).to.deep.equal([9700, 2000, 360, 100, 5000]);
  });

  it("platform_treasury başka bir mint'e aitse reddedilir (ParamOutOfBounds)", async () => {
    const env = setup();
    const otherMint = Keypair.generate().publicKey;
    writeMint(env, otherMint, env.mintAuthority.publicKey, 0n);
    const wrong = Keypair.generate().publicKey;
    writeTokenAccount(env, wrong, otherMint, env.wallets.platform.publicKey, 0n);
    const ix = await createPoolIx(env, HOUSE_PARAMS, { platformTreasury: wrong });
    expectAnchorError(env, [ix], [env.wallets.platform], "ParamOutOfBounds");
  });

  it("aynı admin ve pool_id ikinci kez açılamaz; farklı pool_id açılır (izole havuzlar)", async () => {
    const env = setup();
    await create(env, { ...HOUSE_PARAMS, poolId: 5n });
    const res = await createPoolIx(env, { ...HOUSE_PARAMS, poolId: 5n });
    let failed = false;
    try {
      sendTx(env, [res], [env.wallets.platform]);
    } catch {
      failed = true;
    }
    expect(failed).to.equal(true);
    const other = await create(env, { ...HOUSE_PARAMS, poolId: 6n });
    expect(other.poolId).to.equal(6n);
  });

  it("parametreleri değiştiren instruction yoktur (IDL'de set/update yok)", () => {
    const env = setup();
    const names: string[] = env.program!.idl.instructions.map((i: any) => i.name.toLowerCase());
    expect(names.filter((n) => /^(set|update|change|edit)/.test(n))).to.deep.equal([]);
    expect(names).to.include("createpool");
  });
});
