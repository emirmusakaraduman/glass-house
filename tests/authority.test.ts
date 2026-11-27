// Yetki testleri: yanlış imzacıyla çağrılan instruction'lar reddedilmeli ve HATA KODU net olmalı.
//
// Kapsam: create_pool, fund_first_loss, approve_loan, confirm_title, record_recovery,
//         apply_loan (satıcı == borçlu), confirm_title'ın ikinci çağrısı.
//
// Kurallar:
// - Her ret testinde Anchor hata ADI ve NUMARASI birlikte kontrol edilir (`expectAnchorError`);
//   genel "işlem başarısız" yetmez.
// - Her ret testinin pozitif eşi vardır (doğru imzacı geçer); böylece test "hep başarısız olan
//   bir kurulum" yüzünden yanlışlıkla yeşil olmaz.
// - tests/helpers.ts'e dokunulmaz. Bu dosyaya özel yardımcılar aşağıda.
// - Kişi 1'in instruction'larından IDL'de henüz olmayan çıkarsa ilgili testi `it.skip` yapıp
//   başına `TODO(Kişi1)` yazın. Şu an hepsi IDL'de, hiçbiri skip değil.

import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Signer,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { FailedTransactionMetadata } from "litesvm";
import {
  AssetType,
  createPool,
  ensureUsdcAta,
  fundLoanIx,
  fundSol,
  fundUsdc,
  HOUSE_PARAMS,
  LoanStatus,
  loanPdas,
  PoolHandle,
  patchPool,
  PoolParams,
  poolPdas,
  readLoan,
  readPool,
  recordRecoveryIx,
  sendTx,
  setupEnv,
  TestEnv,
  tokenBalance,
  trySendTx,
  USDC,
  usdcAta,
  warp,
  writeLoanFixture,
} from "./helpers";

// ───────────────────────────── Hata kodları (errors.rs) ─────────────────────────────

const ERR = {
  Unauthorized: 6000,
  InvalidStatus: 6001,
  SellerIsBorrower: 6002,
  ParamOutOfBounds: 6009,
  ZeroAmount: 6014,
  InvalidCoSigner: 6022,
  // Anchor çerçeve hataları
  ConstraintSeeds: 2006,
} as const;
type ErrName = keyof typeof ERR;

/**
 * İşlemin başarısız olmasını ve Anchor loglarında HEM hata adının HEM numarasının geçmesini bekler:
 * "Error Code: Unauthorized. Error Number: 6000."
 */
function expectAnchorError(
  env: TestEnv,
  ixs: TransactionInstruction[],
  signers: Signer[],
  name: ErrName,
): void {
  const res = trySendTx(env, ixs, signers);
  if (!(res instanceof FailedTransactionMetadata)) {
    throw new Error(`İşlem ${name} (${ERR[name]}) ile reddedilmeliydi ama başarılı oldu`);
  }
  const logs = res.meta().logs().join("\n");
  const want = `Error Code: ${name}. Error Number: ${ERR[name]}.`;
  if (!logs.includes(want)) {
    throw new Error(`Beklenen "${want}" bulunamadı.\nHata: ${res.toString()}\nLoglar:\n${logs}`);
  }
}

// ───────────────────────────── Instruction oluşturucular (bu dosyaya özel) ─────────────────────────────

function program(env: TestEnv) {
  if (!env.program) throw new Error("IDL yok: önce 'npm run build' çalıştırın.");
  return env.program;
}

/** create_pool argümanı: PoolParams (helpers) → Anchor istemci biçimi. */
function poolParamsArg(env: TestEnv, p: PoolParams) {
  return {
    poolId: new BN((p.poolId ?? 0n).toString()),
    assetType: p.assetType === AssetType.House ? { house: {} } : { vehicle: {} },
    underwriter: env.wallets.underwriter.publicKey,
    titleAgent: env.wallets.titleAgent.publicKey,
    recoveryAgent: env.recoveryAgent.publicKey,
    maxLtvBps: p.maxLtvBps,
    rateBps: p.rateBps,
    termMonths: p.termMonths,
    recoveryCoeffBps: p.recoveryCoeffBps,
    graceSeconds: new BN(p.graceSeconds.toString()),
    periodSeconds: new BN(p.periodSeconds.toString()),
    provisionBps: p.provisionBps ?? [0, 500, 1500, 1500],
    bufferBps: p.bufferBps ?? 1000,
    brakeLateBps: p.brakeLateBps ?? 1000,
    brakeReserveBps: p.brakeReserveBps ?? 25,
    minFirstLossBps: p.minFirstLossBps ?? 500,
    entryExitFeeBps: p.entryExitFeeBps ?? 20,
    minRecoveryBps: p.minRecoveryBps ?? 5000,
    titleTimeoutSeconds: new BN((p.titleTimeoutSeconds ?? 600n).toString()),
  };
}

/**
 * create_pool. `admin`: imzacı; `poolAdmin`: Pool PDA'sının türetildiği admin (varsayılan `admin`).
 * Farklı verilirse saldırı senaryosu kurulur: yabancı, başkasının adresine havuz açmaya çalışır.
 */
function createPoolIx(
  env: TestEnv,
  params: PoolParams,
  admin: PublicKey = env.wallets.platform.publicKey,
  poolAdmin: PublicKey = admin,
): Promise<TransactionInstruction> {
  const pdas = poolPdas(env.programId, poolAdmin, params.poolId ?? 0n);
  return program(env)
    .methods.createPool(poolParamsArg(env, params))
    .accountsStrict({
      admin,
      pool: pdas.pool,
      usdcMint: env.usdcMint,
      platformTreasury: usdcAta(env, env.wallets.platform.publicKey),
      vault: pdas.vault,
      firstLossVault: pdas.firstLoss,
      reserveVault: pdas.reserve,
      shareMint: pdas.shareMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

function fundFirstLossIx(
  env: TestEnv,
  pool: PoolHandle,
  admin: PublicKey,
  amount: bigint,
  adminTokenAccount: PublicKey = usdcAta(env, admin),
): Promise<TransactionInstruction> {
  return program(env)
    .methods.fundFirstLoss(new BN(amount.toString()))
    .accountsStrict({
      admin,
      pool: pool.pool,
      adminTokenAccount,
      firstLossVault: pool.firstLoss,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

function applyLoanIx(
  env: TestEnv,
  pool: PoolHandle,
  borrower: PublicKey,
  seller: PublicKey,
  price: bigint,
  downPayment: bigint,
): Promise<TransactionInstruction> {
  const { loan, escrow, collateral } = loanPdas(env.programId, pool.pool, readPool(env, pool.pool).nextLoanId);
  return program(env)
    .methods.applyLoan(new BN(price.toString()), new BN(downPayment.toString()))
    .accountsStrict({
      borrower,
      seller,
      pool: pool.pool,
      loan,
      usdcMint: env.usdcMint,
      borrowerUsdc: usdcAta(env, borrower),
      loanEscrow: escrow,
      collateralEscrow: collateral,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
}

function approveLoanIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  underwriter: PublicKey,
  decision: "approve" | "reject" = "approve",
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { escrow, collateral } = loanPdas(env.programId, pool.pool, l.id);
  const hash = (b: number) => Array.from(new Uint8Array(32).fill(b));
  return program(env)
    .methods.approveLoan(
      decision === "approve" ? { approve: {} } : { reject: {} },
      new BN(l.price.toString()), // ekspertiz = fiyat
      hash(1),
      hash(2),
      1,
      true,
      true,
    )
    .accountsStrict({
      underwriter,
      pool: pool.pool,
      loan,
      borrower: l.borrower,
      borrowerUsdc: usdcAta(env, l.borrower),
      loanEscrow: escrow,
      collateralEscrow: collateral,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

function confirmTitleIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  titleAgent: PublicKey,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { escrow } = loanPdas(env.programId, pool.pool, l.id);
  return program(env)
    .methods.confirmTitle()
    .accountsStrict({
      titleAgent,
      pool: pool.pool,
      loan,
      loanEscrow: escrow,
      sellerUsdc: usdcAta(env, l.seller),
      reserveVault: pool.reserve,
      platformTreasury: pool.platformTreasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// ───────────────────────────── Senaryo kurucular ─────────────────────────────

const PRICE = 100_000n * USDC;
const DOWN = 30_000n * USDC; // ev: %70 LTV → en az %30 peşinat

/** Likiditesi ve ilk zarar kasası olan ev havuzu; borçlu ve satıcı hazır. */
function setup(): { env: TestEnv; pool: PoolHandle } {
  const env = setupEnv();
  const pool = createPool(env, HOUSE_PARAMS, {
    liquidity: 1_000_000n * USDC,
    firstLoss: 60_000n * USDC,
  });
  fundUsdc(env, env.wallets.borrower1.publicKey, 50_000n * USDC);
  ensureUsdcAta(env, env.wallets.seller.publicKey);
  return { env, pool };
}

/** apply_loan ile gerçek bir `Pending` kredi açar. */
async function pendingLoan(env: TestEnv, pool: PoolHandle): Promise<PublicKey> {
  const { borrower1, seller } = env.wallets;
  const { loan } = loanPdas(env.programId, pool.pool, readPool(env, pool.pool).nextLoanId);
  sendTx(env, [await applyLoanIx(env, pool, borrower1.publicKey, seller.publicKey, PRICE, DOWN)], [borrower1, seller]);
  return loan;
}

/** Pending → Approved (underwriter) → Funded (izinsiz fund_loan). */
async function fundedLoan(env: TestEnv, pool: PoolHandle): Promise<PublicKey> {
  const loan = await pendingLoan(env, pool);
  const uw = env.wallets.underwriter;
  sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey)], [uw]);
  sendTx(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger]);
  return loan;
}

// ───────────────────────────── Testler ─────────────────────────────

describe("yetki: create_pool", () => {
  it("admin imzasıyla havuz açılır (pozitif kontrol)", async () => {
    const env = setupEnv();
    ensureUsdcAta(env, env.wallets.platform.publicKey);
    const admin = env.wallets.platform;
    sendTx(env, [await createPoolIx(env, HOUSE_PARAMS)], [admin]);
    const { pool } = poolPdas(env.programId, admin.publicKey, 0n);
    expect(readPool(env, pool).admin.toBase58()).to.equal(admin.publicKey.toBase58());
  });

  it("yabancı, başkasının admin adresine türetilmiş havuzu açamaz (ConstraintSeeds)", async () => {
    const env = setupEnv();
    ensureUsdcAta(env, env.wallets.platform.publicKey);
    const s = env.wallets.stranger;
    // İmzacı yabancı; ama Pool PDA'sı platform admin'inin seed'iyle türetilmiş.
    const ix = await createPoolIx(env, HOUSE_PARAMS, s.publicKey, env.wallets.platform.publicKey);
    expectAnchorError(env, [ix], [s], "ConstraintSeeds");
  });

  it("aynı admin + pool_id ile ikinci kez açılamaz (hesap zaten var)", async () => {
    const env = setupEnv();
    ensureUsdcAta(env, env.wallets.platform.publicKey);
    const admin = env.wallets.platform;
    sendTx(env, [await createPoolIx(env, HOUSE_PARAMS)], [admin]);
    const res = trySendTx(env, [await createPoolIx(env, HOUSE_PARAMS)], [admin]);
    expect(res).to.be.instanceOf(FailedTransactionMetadata);
    expect((res as FailedTransactionMetadata).meta().logs().join("\n")).to.include("already in use");
  });

  it("sınır dışı parametre reddedilir: max_ltv > %97 (ParamOutOfBounds)", async () => {
    const env = setupEnv();
    ensureUsdcAta(env, env.wallets.platform.publicKey);
    const ix = await createPoolIx(env, { ...HOUSE_PARAMS, maxLtvBps: 9800 });
    expectAnchorError(env, [ix], [env.wallets.platform], "ParamOutOfBounds");
  });
});

describe("yetki: fund_first_loss", () => {
  it("admin doldurur, sayaç ve token bakiyesi artar (pozitif kontrol)", async () => {
    const { env, pool } = setup();
    const admin = env.wallets.platform;
    fundUsdc(env, admin.publicKey, 10_000n * USDC);
    const before = readPool(env, pool.pool).firstLossBalance;
    sendTx(env, [await fundFirstLossIx(env, pool, admin.publicKey, 5_000n * USDC)], [admin]);
    expect(readPool(env, pool.pool).firstLossBalance).to.equal(before + 5_000n * USDC);
    expect(tokenBalance(env, pool.firstLoss)).to.equal(before + 5_000n * USDC);
  });

  it("yabancı admin gibi imzalarsa Unauthorized; kasa değişmez", async () => {
    const { env, pool } = setup();
    const s = env.wallets.stranger;
    fundUsdc(env, s.publicKey, 10_000n * USDC);
    const vaultBefore = tokenBalance(env, pool.firstLoss);
    expectAnchorError(env, [await fundFirstLossIx(env, pool, s.publicKey, 5_000n * USDC)], [s], "Unauthorized");
    expect(tokenBalance(env, pool.firstLoss)).to.equal(vaultBefore);
    expect(tokenBalance(env, usdcAta(env, s.publicKey))).to.equal(10_000n * USDC);
  });

  it("diğer roller (underwriter, tescil ajanı) admin yerine geçemez", async () => {
    const { env, pool } = setup();
    for (const w of [env.wallets.underwriter, env.wallets.titleAgent]) {
      fundUsdc(env, w.publicKey, 10_000n * USDC);
      expectAnchorError(env, [await fundFirstLossIx(env, pool, w.publicKey, 1_000n * USDC)], [w], "Unauthorized");
    }
  });

  it("admin başkasının token hesabını veremez (Unauthorized)", async () => {
    const { env, pool } = setup();
    const admin = env.wallets.platform;
    const victim = env.wallets.investor1.publicKey;
    fundUsdc(env, victim, 10_000n * USDC);
    const ix = await fundFirstLossIx(env, pool, admin.publicKey, 1_000n * USDC, usdcAta(env, victim));
    expectAnchorError(env, [ix], [admin], "Unauthorized");
    expect(tokenBalance(env, usdcAta(env, victim))).to.equal(10_000n * USDC);
  });

  it("sıfır tutar reddedilir (ZeroAmount)", async () => {
    const { env, pool } = setup();
    const admin = env.wallets.platform;
    expectAnchorError(env, [await fundFirstLossIx(env, pool, admin.publicKey, 0n)], [admin], "ZeroAmount");
  });
});

describe("yetki: apply_loan", () => {
  it("satıcı ve borçlu farklıysa kredi Pending açılır (pozitif kontrol)", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Pending);
  });

  it("satıcı == borçlu reddedilir (SellerIsBorrower); peşinat borçluda kalır", async () => {
    const { env, pool } = setup();
    const b = env.wallets.borrower1;
    const before = tokenBalance(env, usdcAta(env, b.publicKey));
    // Aynı anahtar hem borrower hem seller: tek imza iki Signer'ı da karşılar.
    const ix = await applyLoanIx(env, pool, b.publicKey, b.publicKey, PRICE, DOWN);
    expectAnchorError(env, [ix], [b], "SellerIsBorrower");
    expect(tokenBalance(env, usdcAta(env, b.publicKey))).to.equal(before);
    expect(readPool(env, pool.pool).nextLoanId).to.equal(0n);
  });
});

describe("yetki: approve_loan", () => {
  it("underwriter onaylar: Pending → Approved (pozitif kontrol)", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    const uw = env.wallets.underwriter;
    sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey)], [uw]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Approved);
  });

  it("yabancı ne onaylayabilir ne reddedebilir (Unauthorized); kredi Pending kalır", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    const s = env.wallets.stranger;
    expectAnchorError(env, [await approveLoanIx(env, pool, loan, s.publicKey, "approve")], [s], "Unauthorized");
    expectAnchorError(env, [await approveLoanIx(env, pool, loan, s.publicKey, "reject")], [s], "Unauthorized");
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Pending);
  });

  it("diğer roller (borçlu, satıcı, tescil ajanı, admin) underwriter yerine geçemez", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    const w = env.wallets;
    for (const who of [w.borrower1, w.seller, w.titleAgent, w.platform]) {
      expectAnchorError(env, [await approveLoanIx(env, pool, loan, who.publicKey)], [who], "Unauthorized");
    }
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Pending);
  });

  it("başka havuzun underwriter'ı bu havuzun kredisini onaylayamaz", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    // 2. havuz (pool_id = 1): underwriter'ı otherUw. otherUw kendi havuzunda yetkili, bu havuzda değil.
    const otherUw = Keypair.generate();
    fundSol(env, otherUw.publicKey, 10);
    const other = createPool(env, { ...HOUSE_PARAMS, poolId: 1n }, { liquidity: 1_000n * USDC });
    patchPool(env, other.pool, { underwriter: otherUw.publicKey });
    expect(readPool(env, other.pool).underwriter.toBase58()).to.equal(otherUw.publicKey.toBase58());

    const ix = await approveLoanIx(env, pool, loan, otherUw.publicKey);
    expectAnchorError(env, [ix], [otherUw], "Unauthorized");
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Pending);
  });
});

describe("yetki: confirm_title", () => {
  it("tescil ajanı onaylar: Funded → Active, satıcıya fiyat ödenir (pozitif kontrol)", async () => {
    const { env, pool } = setup();
    const loan = await fundedLoan(env, pool);
    const agent = env.wallets.titleAgent;
    const seller = usdcAta(env, env.wallets.seller.publicKey);
    sendTx(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Active);
    expect(tokenBalance(env, seller)).to.equal(PRICE);
  });

  it("yabancı ve diğer roller tescil onaylayamaz (Unauthorized); para yerinde kalır", async () => {
    const { env, pool } = setup();
    const loan = await fundedLoan(env, pool);
    const w = env.wallets;
    const seller = usdcAta(env, w.seller.publicKey);
    // Satıcı da dahil: kendi parasını kendisi serbest bırakamaz.
    for (const who of [w.stranger, w.underwriter, w.borrower1, w.seller, w.platform]) {
      expectAnchorError(env, [await confirmTitleIx(env, pool, loan, who.publicKey)], [who], "Unauthorized");
    }
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Funded);
    expect(tokenBalance(env, seller)).to.equal(0n);
  });

  it("aynı kredi için ikinci confirm_title reddedilir (InvalidStatus); satıcıya iki kez ödenmez", async () => {
    const { env, pool } = setup();
    const loan = await fundedLoan(env, pool);
    const agent = env.wallets.titleAgent;
    const seller = usdcAta(env, env.wallets.seller.publicKey);
    sendTx(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent]);
    const reserve = tokenBalance(env, pool.reserve);
    const idle = readPool(env, pool.pool).idleCash;

    expectAnchorError(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent], "InvalidStatus");

    expect(tokenBalance(env, seller)).to.equal(PRICE);
    expect(tokenBalance(env, pool.reserve)).to.equal(reserve);
    expect(readPool(env, pool.pool).idleCash).to.equal(idle);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Active);
  });

  it("Pending (fonlanmamış) krediye confirm_title uygulanamaz (InvalidStatus)", async () => {
    const { env, pool } = setup();
    const loan = await pendingLoan(env, pool);
    const agent = env.wallets.titleAgent;
    expectAnchorError(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent], "InvalidStatus");
  });
});

describe("yetki: record_recovery", () => {
  function defaulted() {
    const env = setupEnv();
    const pool = createPool(env, HOUSE_PARAMS, {
      liquidity: 1_000_000n * USDC,
      firstLoss: 50_000n * USDC,
      reserve: 2_000n * USDC,
    });
    const { loan } = writeLoanFixture(env, pool, { status: LoanStatus.Defaulted });
    for (const w of [env.recoveryAgent, env.wallets.stranger, env.wallets.underwriter, env.wallets.platform]) {
      fundUsdc(env, w.publicKey, 200_000n * USDC);
    }
    warp(env, 12 * 60);
    return { env, pool, loan };
  }

  it("recovery_agent kaydeder: Defaulted → Recovered (pozitif kontrol)", async () => {
    const { env, pool, loan } = defaulted();
    sendTx(env, [await recordRecoveryIx(env, pool, loan, 63_000n * USDC)], [env.recoveryAgent]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Recovered);
  });

  it("yabancı, underwriter ve admin recovery_agent yerine geçemez (Unauthorized)", async () => {
    const { env, pool, loan } = defaulted();
    for (const who of [env.wallets.stranger, env.wallets.underwriter, env.wallets.platform]) {
      const ix = await recordRecoveryIx(env, pool, loan, 63_000n * USDC, { recoveryAgent: who.publicKey });
      expectAnchorError(env, [ix], [who], "Unauthorized");
    }
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Defaulted);
  });

  it("alt sınırın altında yanlış ortak imzacı reddedilir (InvalidCoSigner), admin ile geçer", async () => {
    const { env, pool, loan } = defaulted();
    const agent = env.recoveryAgent;
    const low = 10_000n * USDC; // min_recovery (%50 × 100k) altında
    const bad = await recordRecoveryIx(env, pool, loan, low, { coSigner: env.wallets.stranger.publicKey });
    expectAnchorError(env, [bad], [agent, env.wallets.stranger], "InvalidCoSigner");

    const good = await recordRecoveryIx(env, pool, loan, low, { coSigner: env.wallets.platform.publicKey });
    sendTx(env, [good], [agent, env.wallets.platform]);
    expect(readLoan(env, loan).status).to.equal(LoanStatus.Recovered);
  });
});
