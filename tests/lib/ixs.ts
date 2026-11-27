// Kişi 1'in instruction'ları için ortak test yardımcıları (LiteSVM). SAHİBİ: Kişi 2.
//
// tests/helpers.ts hesapları FIXTURE ile yazar; burada gerçek instruction'lar çağrılır:
// create_pool, fund_first_loss, apply_loan, approve_loan, confirm_title, cancel_funding.
// Her yardımcı bir `TransactionInstruction` döndürür; gönderme için helpers.ts'teki sendTx / trySendTx.
//
// Hata kontrolü: `expectAnchorError` Anchor hata ADI ve NUMARASINI birlikte doğrular.

import { BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction } from "@solana/web3.js";
import { FailedTransactionMetadata, TransactionMetadata } from "litesvm";
import {
  AssetType,
  createPool,
  CreatePoolOptions,
  ensureUsdcAta,
  fundLoanIx,
  fundUsdc,
  HOUSE_PARAMS,
  loanPdas,
  PoolHandle,
  PoolParams,
  poolPdas,
  readLoan,
  readPool,
  sendTx,
  setupEnv,
  TestEnv,
  trySendTx,
  USDC,
  usdcAta,
} from "../helpers";
import { Signer } from "@solana/web3.js";

// ───────────────────────────── Hata kodları (errors.rs) ─────────────────────────────

export const ERR = {
  Unauthorized: 6000,
  InvalidStatus: 6001,
  SellerIsBorrower: 6002,
  InsufficientDownPayment: 6003,
  AppraisalTooLow: 6004,
  LiquidityBufferBreached: 6005,
  BrakeLateRatio: 6006,
  BrakeReserve: 6007,
  InsufficientFirstLoss: 6008,
  ParamOutOfBounds: 6009,
  MathOverflow: 6010,
  TitleDeadlinePassed: 6011,
  TitleDeadlineNotReached: 6012,
  InvariantViolation: 6013,
  ZeroAmount: 6014,
  LoanNotServiceable: 6015,
  PeriodAlreadyProcessed: 6016,
  RecoveryBelowFloor: 6017,
  InvalidCoSigner: 6022,
  // Anchor çerçeve hataları
  ConstraintSeeds: 2006,
  AccountNotInitialized: 3012,
} as const;
export type ErrName = keyof typeof ERR;

/** Başarısız işlemin loglarında "Error Code: <ad>. Error Number: <no>." geçmesini bekler. */
export function expectAnchorError(env: TestEnv, ixs: TransactionInstruction[], signers: Signer[], name: ErrName): void {
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

/** Başarısız işlemin loglarını döndürür (özel mesaj kontrolleri için); başarılıysa hata fırlatır. */
export function failureLogs(env: TestEnv, ixs: TransactionInstruction[], signers: Signer[]): string {
  const res = trySendTx(env, ixs, signers);
  if (!(res instanceof FailedTransactionMetadata)) throw new Error("işlem başarısız olmalıydı");
  return res.meta().logs().join("\n") + "\n" + res.toString();
}

function program(env: TestEnv) {
  if (!env.program) throw new Error("IDL yok: önce 'npm run build' çalıştırın.");
  return env.program;
}

// ───────────────────────────── Instruction oluşturucular ─────────────────────────────

/** helpers.PoolParams → create_pool argümanı (Anchor istemci biçimi). */
export function poolParamsArg(env: TestEnv, p: PoolParams) {
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
 * create_pool. `admin` imzacı; `poolAdmin` Pool PDA'sının türetildiği admin (varsayılan `admin`);
 * `platformTreasury` varsayılan platform cüzdanının USDC ATA'sı.
 */
export function createPoolIx(
  env: TestEnv,
  params: PoolParams,
  opts: { admin?: PublicKey; poolAdmin?: PublicKey; platformTreasury?: PublicKey; usdcMint?: PublicKey } = {},
): Promise<TransactionInstruction> {
  const admin = opts.admin ?? env.wallets.platform.publicKey;
  const pdas = poolPdas(env.programId, opts.poolAdmin ?? admin, params.poolId ?? 0n);
  return program(env)
    .methods.createPool(poolParamsArg(env, params))
    .accountsStrict({
      admin,
      pool: pdas.pool,
      usdcMint: opts.usdcMint ?? env.usdcMint,
      platformTreasury: opts.platformTreasury ?? usdcAta(env, env.wallets.platform.publicKey),
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

export function fundFirstLossIx(
  env: TestEnv,
  pool: PoolHandle,
  admin: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction> {
  return program(env)
    .methods.fundFirstLoss(new BN(amount.toString()))
    .accountsStrict({
      admin,
      pool: pool.pool,
      adminTokenAccount: usdcAta(env, admin),
      firstLossVault: pool.firstLoss,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** apply_loan: borrower ve seller birlikte imzalar. Kredi id'si havuzun `next_loan_id`'sinden. */
export function applyLoanIx(
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

/** approve_loan. `appraised` varsayılan: kredinin fiyatı. */
export function approveLoanIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  underwriter: PublicKey,
  decision: "approve" | "reject" = "approve",
  appraised?: bigint,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { escrow, collateral } = loanPdas(env.programId, pool.pool, l.id);
  const hash = (b: number) => Array.from(new Uint8Array(32).fill(b));
  return program(env)
    .methods.approveLoan(
      decision === "approve" ? { approve: {} } : { reject: {} },
      new BN((appraised ?? l.price).toString()),
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

export function confirmTitleIx(
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

/** cancel_funding (izinsiz; süre dolunca). */
export function cancelFundingIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  caller: PublicKey = env.wallets.stranger.publicKey,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { escrow, collateral } = loanPdas(env.programId, pool.pool, l.id);
  return program(env)
    .methods.cancelFunding()
    .accountsStrict({
      caller,
      pool: pool.pool,
      loan,
      vault: pool.vault,
      loanEscrow: escrow,
      collateralEscrow: collateral,
      borrower: l.borrower,
      borrowerUsdc: usdcAta(env, l.borrower),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// ───────────────────────────── Senaryo kurucular ─────────────────────────────

export const HOUSE_PRICE = 100_000n * USDC;
export const HOUSE_DOWN = 30_000n * USDC; // %30
export const VEHICLE_PRICE = 20_000n * USDC;
export const VEHICLE_DOWN = 8_000n * USDC; // %40

/** Havuz + borçlu(lar) hazır bir ortam. `params` varsayılan ev. */
export function setupPool(
  params: PoolParams = HOUSE_PARAMS,
  opts: CreatePoolOptions = { liquidity: 1_000_000n * USDC, firstLoss: 60_000n * USDC },
): { env: TestEnv; pool: PoolHandle } {
  const env = setupEnv();
  const pool = createPool(env, params, opts);
  fundUsdc(env, env.wallets.borrower1.publicKey, 100_000n * USDC);
  fundUsdc(env, env.wallets.borrower2.publicKey, 100_000n * USDC);
  ensureUsdcAta(env, env.wallets.seller.publicKey);
  return { env, pool };
}

/** apply_loan ile gerçek bir `Pending` kredi açar; kredi hesabını döndürür. */
export async function pendingLoan(
  env: TestEnv,
  pool: PoolHandle,
  o: { borrower?: Keypair; price?: bigint; down?: bigint } = {},
): Promise<PublicKey> {
  const borrower = o.borrower ?? env.wallets.borrower1;
  const isVehicle = pool.params.assetType === AssetType.Vehicle;
  const price = o.price ?? (isVehicle ? VEHICLE_PRICE : HOUSE_PRICE);
  const down = o.down ?? (isVehicle ? VEHICLE_DOWN : HOUSE_DOWN);
  const seller = env.wallets.seller;
  const { loan } = loanPdas(env.programId, pool.pool, readPool(env, pool.pool).nextLoanId);
  sendTx(env, [await applyLoanIx(env, pool, borrower.publicKey, seller.publicKey, price, down)], [borrower, seller]);
  return loan;
}

/** Pending → Approved (underwriter). */
export async function approvedLoan(env: TestEnv, pool: PoolHandle, o: Parameters<typeof pendingLoan>[2] = {}): Promise<PublicKey> {
  const loan = await pendingLoan(env, pool, o);
  const uw = env.wallets.underwriter;
  sendTx(env, [await approveLoanIx(env, pool, loan, uw.publicKey)], [uw]);
  return loan;
}

/** Approved → Funded (izinsiz fund_loan). */
export async function fundedLoan(env: TestEnv, pool: PoolHandle, o: Parameters<typeof pendingLoan>[2] = {}): Promise<PublicKey> {
  const loan = await approvedLoan(env, pool, o);
  sendTx(env, [await fundLoanIx(env, pool, loan)], [env.wallets.stranger]);
  return loan;
}

/** Funded → Active (tescil ajanı). */
export async function activeLoan(env: TestEnv, pool: PoolHandle, o: Parameters<typeof pendingLoan>[2] = {}): Promise<PublicKey> {
  const loan = await fundedLoan(env, pool, o);
  const agent = env.wallets.titleAgent;
  sendTx(env, [await confirmTitleIx(env, pool, loan, agent.publicKey)], [agent]);
  return loan;
}

export type { TransactionMetadata };
