// GlassHouse ortak test yardımcıları (LiteSVM). SAHİBİ: Kişi 2. Kişi 1 de kullanır.
//
// Tasarım:
// - Her test kendi `setupEnv()` ortamını kurar; testler birbirinin durumunu görmez.
// - Tutarlar her yerde micro-USDC `bigint` (1 USDC = 1_000_000n). Oranlar bps `number`.
// - Hesaplar iki yolla oluşur:
//     1) Fixture: hesap baytları doğrudan yazılır (`createPool`, `writeLoanFixture`). Kişi 1'in
//        instruction'ları gelmeden crank/recovery testleri bu yolla yazılır.
//     2) Instruction: `env.program.methods.x(...).instruction()` + `sendTx()`. IDL'de instruction
//        olunca kullanılır.
// - İmzalar sabittir; yeni parametreler yalnızca opsiyonel alan olarak eklenir.

import * as fs from "fs";
import * as path from "path";
import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import {
  AccountLayout,
  ACCOUNT_SIZE,
  getAssociatedTokenAddressSync,
  MintLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import {
  AssetType,
  decodeLoan,
  decodePool,
  encodeLoan,
  encodePool,
  LoanState,
  LoanStatus,
  PoolState,
  PoolStatus,
} from "./lib/layout";
import * as loanMath from "./helpers/loanMath";

export { loanMath };
export { AssetType, LoanStatus, PoolStatus, LOAN_SIZE, POOL_SIZE } from "./lib/layout";
export type { LoanState, PoolState } from "./lib/layout";

// ───────────────────────────── Sabitler ─────────────────────────────

const ROOT = path.resolve(__dirname, "..");

/** 1 USDC, micro-USDC cinsinden. `50_000n * USDC` = 50.000 USDC. */
export const USDC = 1_000_000n;
export const USDC_DECIMALS = 6;
export const BPS = 10_000n;

/** Program ID: Anchor.toml / declare_id ile aynı. IDL varsa oradan okunur. */
export const PROGRAM_ID = new PublicKey(
  readIdl()?.address ?? "9XkjiBit6jETrVJUGHsiix71wbTr9J8yX7XmaNqpvosM",
);
/**
 * Yüklenecek program. Varsayılan yerel derleme; başka bir binary'yi (ör. Kişi 1'in devnet
 * .so'su) test etmek için: `GLASSHOUSE_SO=/yol/glasshouse.so npm test`.
 */
export const PROGRAM_SO = process.env.GLASSHOUSE_SO
  ? path.resolve(process.env.GLASSHOUSE_SO)
  : path.join(ROOT, "target", "deploy", "glasshouse.so");

/** Havuz parametreleri — v4 belgesindeki değerler. */
export interface PoolParams {
  assetType: AssetType;
  maxLtvBps: number;
  rateBps: number;
  termMonths: number;
  graceSeconds: bigint;
  periodSeconds: bigint;
  recoveryCoeffBps: number;
  /** [Active, Late1, Late2, Defaulted taban]; azalmayan, ≤ 10000. Varsayılan [0, 500, 1500, 1500]. */
  provisionBps?: [number, number, number, number];
  bufferBps?: number; // 1000
  brakeLateBps?: number; // 1000
  brakeReserveBps?: number; // 25
  minFirstLossBps?: number; // 500 (2008 modunda 0)
  entryExitFeeBps?: number; // 20
  minRecoveryBps?: number; // 5000 (varsayım)
  titleTimeoutSeconds?: bigint; // 600
  /** Aynı admin altında birden çok havuz için. Varsayılan 0. */
  poolId?: bigint;
}

/** Demo süreleri: 1 ay = 60 sn, grace = 10 sn. */
export const DEMO_TIMING = { periodSeconds: 60n, graceSeconds: 10n } as const;

export const HOUSE_PARAMS: PoolParams = {
  assetType: AssetType.House,
  maxLtvBps: 7000,
  rateBps: 700,
  termMonths: 240,
  recoveryCoeffBps: 6300,
  ...DEMO_TIMING,
};

export const VEHICLE_PARAMS: PoolParams = {
  assetType: AssetType.Vehicle,
  maxLtvBps: 6000,
  rateBps: 900,
  termMonths: 60,
  recoveryCoeffBps: 5400,
  ...DEMO_TIMING,
};

/** "2008 modu": aynı program, %97 LTV, ilk zarar kasası ve yedek fon yok. */
export const MODE_2008_PARAMS: PoolParams = {
  ...HOUSE_PARAMS,
  maxLtvBps: 9700,
  minFirstLossBps: 0,
};

// ───────────────────────────── Ortam ─────────────────────────────

/** Demo'daki 9 cüzdan. Hepsi bellekte üretilir; dosyaya yazılmaz. */
export interface Wallets {
  investor1: Keypair;
  investor2: Keypair;
  borrower1: Keypair;
  borrower2: Keypair;
  seller: Keypair;
  underwriter: Keypair;
  titleAgent: Keypair;
  /** Havuz admin'i, `fund_first_loss` yetkilisi ve platform hazinesi. */
  platform: Keypair;
  /** Hiçbir rolü olmayan "yabancı" cüzdan: izinsiz crank'i çalıştırır, yetki testlerinde saldırgan. */
  stranger: Keypair;
}

export interface TestEnv {
  svm: LiteSVM;
  programId: PublicKey;
  wallets: Wallets;
  /** Sahte USDC mint'i (6 hane). Mint yetkisi `mintAuthority`. */
  usdcMint: PublicKey;
  mintAuthority: Keypair;
  /** IDL varsa Anchor istemcisi (yalnızca instruction oluşturmak için; ağa bağlanmaz). */
  program: Program | null;
  /** `record_recovery` yetkilisi. Ayrı bir cüzdan; varsayılan olarak `platform` DEĞİL. */
  recoveryAgent: Keypair;
}

export interface SetupOptions {
  /** Her cüzdana yüklenecek SOL. Varsayılan 100. */
  solPerWallet?: number;
  /** Başlangıç saati (unix sn). Varsayılan 1_800_000_000. */
  startUnixTs?: bigint;
  /** false ise program .so yüklenmez (yalnızca hesap düzeyi testler). Varsayılan true. */
  loadProgram?: boolean;
}

/**
 * Yeni bir LiteSVM ortamı kurar: programı yükler, 9 cüzdanı + recovery ajanını SOL ile fonlar,
 * sahte USDC mint'ini oluşturur ve saati `startUnixTs`'e ayarlar.
 */
export function setupEnv(opts: SetupOptions = {}): TestEnv {
  const svm = new LiteSVM();
  const programId = PROGRAM_ID;
  if (opts.loadProgram ?? true) {
    if (!fs.existsSync(PROGRAM_SO)) {
      throw new Error(`${PROGRAM_SO} yok. Önce 'anchor build' çalıştırın.`);
    }
    svm.addProgramFromFile(programId, PROGRAM_SO);
  }

  const wallets: Wallets = {
    investor1: Keypair.generate(),
    investor2: Keypair.generate(),
    borrower1: Keypair.generate(),
    borrower2: Keypair.generate(),
    seller: Keypair.generate(),
    underwriter: Keypair.generate(),
    titleAgent: Keypair.generate(),
    platform: Keypair.generate(),
    stranger: Keypair.generate(),
  };
  const recoveryAgent = Keypair.generate();
  const mintAuthority = Keypair.generate();

  const env: TestEnv = {
    svm,
    programId,
    wallets,
    usdcMint: Keypair.generate().publicKey,
    mintAuthority,
    program: null,
    recoveryAgent,
  };

  const sol = opts.solPerWallet ?? 100;
  for (const kp of [...Object.values(wallets), recoveryAgent, mintAuthority]) {
    fundSol(env, kp.publicKey, sol);
  }
  writeMint(env, env.usdcMint, mintAuthority.publicKey, 0n);
  setUnixTimestamp(env, opts.startUnixTs ?? 1_800_000_000n);

  const idl = readIdl();
  if (idl) {
    const provider = new AnchorProvider(
      new Connection("http://127.0.0.1:8899"), // kullanılmaz; yalnızca instruction oluşturulur
      new Wallet(wallets.platform),
      {},
    );
    env.program = new Program(idl, provider);
  }
  return env;
}

// ───────────────────────────── SOL / USDC ─────────────────────────────

/** Bir adrese SOL yazar (mevcut lamport'un üzerine yazar). */
export function fundSol(env: TestEnv, owner: PublicKey, sol: number): void {
  env.svm.setAccount(owner, {
    lamports: Math.round(sol * LAMPORTS_PER_SOL),
    data: new Uint8Array(),
    owner: new PublicKey("11111111111111111111111111111111"),
    executable: false,
  });
}

/**
 * `owner`'ın USDC ATA'sını `amount` bakiyesiyle yazar (yoksa oluşturur, varsa bakiyeyi değiştirir).
 * Mint arzı da güncellenir. ATA adresini döndürür.
 */
export function fundUsdc(env: TestEnv, owner: PublicKey, amount: bigint): PublicKey {
  const ata = getAssociatedTokenAddressSync(env.usdcMint, owner, true);
  const before = tokenBalanceOrZero(env, ata);
  writeTokenAccount(env, ata, env.usdcMint, owner, amount);
  adjustMintSupply(env, env.usdcMint, amount - before);
  return ata;
}

/** `owner`'ın USDC ATA'sı; yoksa 0 bakiyeyle oluşturur, varsa dokunmaz. */
export function ensureUsdcAta(env: TestEnv, owner: PublicKey): PublicKey {
  const ata = usdcAta(env, owner);
  if (!env.svm.getAccount(ata)) writeTokenAccount(env, ata, env.usdcMint, owner, 0n);
  return ata;
}

/** `owner`'ın USDC ATA adresi (hesap var olmayabilir). */
export function usdcAta(env: TestEnv, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(env.usdcMint, owner, true);
}

/** Token hesabının bakiyesi. Hesap yoksa hata fırlatır. */
export function tokenBalance(env: TestEnv, tokenAccount: PublicKey): bigint {
  const acc = env.svm.getAccount(tokenAccount);
  if (!acc) throw new Error(`token hesabı yok: ${tokenAccount.toBase58()}`);
  return AccountLayout.decode(Buffer.from(acc.data)).amount;
}

/** Token hesabının bakiyesi; hesap yoksa 0. */
export function tokenBalanceOrZero(env: TestEnv, tokenAccount: PublicKey): bigint {
  const acc = env.svm.getAccount(tokenAccount);
  return acc ? AccountLayout.decode(Buffer.from(acc.data)).amount : 0n;
}

/** Herhangi bir adreste SPL token hesabı yazar (PDA dahil). Mint arzını DEĞİŞTİRMEZ. */
export function writeTokenAccount(
  env: TestEnv,
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
): void {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1, // Initialized
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  env.svm.setAccount(address, {
    lamports: Number(env.svm.minimumBalanceForRentExemption(BigInt(ACCOUNT_SIZE))),
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

/** Herhangi bir adreste SPL mint yazar (6 hane). */
export function writeMint(env: TestEnv, address: PublicKey, authority: PublicKey, supply: bigint): void {
  const data = Buffer.alloc(MINT_SIZE);
  MintLayout.encode(
    {
      mintAuthorityOption: 1,
      mintAuthority: authority,
      supply,
      decimals: USDC_DECIMALS,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  env.svm.setAccount(address, {
    lamports: Number(env.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
  });
}

/** Mint'in toplam arzı. */
export function mintSupply(env: TestEnv, mint: PublicKey): bigint {
  const acc = env.svm.getAccount(mint);
  if (!acc) throw new Error(`mint yok: ${mint.toBase58()}`);
  return MintLayout.decode(Buffer.from(acc.data)).supply;
}

function adjustMintSupply(env: TestEnv, mint: PublicKey, delta: bigint): void {
  const acc = env.svm.getAccount(mint);
  if (!acc) throw new Error("mint yok");
  const m = MintLayout.decode(Buffer.from(acc.data));
  writeMint(env, mint, m.mintAuthority, m.supply + delta);
}

// ───────────────────────────── PDA'lar ─────────────────────────────

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export interface PoolPdas {
  pool: PublicKey;
  vault: PublicKey;
  firstLoss: PublicKey;
  reserve: PublicKey;
  shareMint: PublicKey;
  bumps: { pool: number; vault: number; firstLoss: number; reserve: number; shareMint: number };
}

/** STATE.md seed'leri: pool = ["pool", admin, pool_id LE], diğerleri ["…", pool]. */
export function poolPdas(programId: PublicKey, admin: PublicKey, poolId: bigint): PoolPdas {
  const [pool, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), admin.toBuffer(), u64le(poolId)],
    programId,
  );
  const sub = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed), pool.toBuffer()], programId);
  const [vault, vaultBump] = sub("vault");
  const [firstLoss, firstLossBump] = sub("first_loss");
  const [reserve, reserveBump] = sub("reserve");
  const [shareMint, shareMintBump] = sub("shares");
  return {
    pool,
    vault,
    firstLoss,
    reserve,
    shareMint,
    bumps: { pool: poolBump, vault: vaultBump, firstLoss: firstLossBump, reserve: reserveBump, shareMint: shareMintBump },
  };
}

export interface LoanPdas {
  loan: PublicKey;
  escrow: PublicKey;
  collateral: PublicKey;
  bumps: { loan: number; escrow: number; collateral: number };
}

/** loan = ["loan", pool, loan_id LE], escrow = ["escrow", loan], collateral = ["collateral", loan]. */
export function loanPdas(programId: PublicKey, pool: PublicKey, loanId: bigint): LoanPdas {
  const [loan, loanBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("loan"), pool.toBuffer(), u64le(loanId)],
    programId,
  );
  const [escrow, escrowBump] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), loan.toBuffer()], programId);
  const [collateral, collateralBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("collateral"), loan.toBuffer()],
    programId,
  );
  return { loan, escrow, collateral, bumps: { loan: loanBump, escrow: escrowBump, collateral: collateralBump } };
}

/** WithdrawRequest = ["wreq", pool, seq LE]. */
export function withdrawRequestPda(programId: PublicKey, pool: PublicKey, seq: bigint): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("wreq"), pool.toBuffer(), u64le(seq)], programId)[0];
}

// ───────────────────────────── Havuz ─────────────────────────────

export interface PoolHandle extends PoolPdas {
  params: PoolParams;
  admin: Keypair;
  /** pool.platform_treasury: platform cüzdanının USDC ATA'sı (token hesabı, cüzdan değil). */
  platformTreasury: PublicKey;
}

export interface CreatePoolOptions {
  /** Vault'a konacak başlangıç likiditesi (idle_cash + vault bakiyesi). Paylar 1:1 basılır. */
  liquidity?: bigint;
  /** İlk zarar kasası (first_loss_balance + token bakiyesi). */
  firstLoss?: bigint;
  /** Yedek fon (reserve_balance + token bakiyesi). */
  reserve?: bigint;
}

/**
 * Havuzu kurar: Pool hesabı + Vault / FirstLossVault / Reserve token hesapları + ShareMint.
 * Roller `env.wallets`'tan: admin = platform, underwriter, titleAgent; recovery_agent = env.recoveryAgent.
 *
 * ŞU AN fixture yoluyla yazar (create_pool instruction'ı Kişi 1'de). Instruction gelince bu
 * fonksiyonun gövdesi instruction'ı çağıracak şekilde değişir; imza ve dönüş değeri aynı kalır.
 */
export function createPool(env: TestEnv, params: PoolParams, opts: CreatePoolOptions = {}): PoolHandle {
  const admin = env.wallets.platform;
  const poolId = params.poolId ?? 0n;
  const pdas = poolPdas(env.programId, admin.publicKey, poolId);
  const liquidity = opts.liquidity ?? 0n;
  const firstLoss = opts.firstLoss ?? 0n;
  const reserve = opts.reserve ?? 0n;

  const state: PoolState = {
    admin: admin.publicKey,
    assetType: params.assetType,
    underwriter: env.wallets.underwriter.publicKey,
    titleAgent: env.wallets.titleAgent.publicKey,
    recoveryAgent: env.recoveryAgent.publicKey,
    usdcMint: env.usdcMint,
    platformTreasury: ensureUsdcAta(env, env.wallets.platform.publicKey),
    poolId,
    maxLtvBps: params.maxLtvBps,
    rateBps: params.rateBps,
    termMonths: params.termMonths,
    recoveryCoeffBps: params.recoveryCoeffBps,
    graceSeconds: params.graceSeconds,
    periodSeconds: params.periodSeconds,
    provisionBps: params.provisionBps ?? [0, 500, 1500, 1500],
    bufferBps: params.bufferBps ?? 1000,
    brakeLateBps: params.brakeLateBps ?? 1000,
    brakeReserveBps: params.brakeReserveBps ?? 25,
    minFirstLossBps: params.minFirstLossBps ?? 500,
    entryExitFeeBps: params.entryExitFeeBps ?? 20,
    minRecoveryBps: params.minRecoveryBps ?? 5000,
    titleTimeoutSeconds: params.titleTimeoutSeconds ?? 600n,
    nextLoanId: 0n,
    idleCash: liquidity,
    totalOutstanding: 0n,
    lateDefaultPrincipal: 0n,
    lossProvision: 0n,
    firstLossBalance: firstLoss,
    reserveBalance: reserve,
    reservePending: 0n,
    totalShares: liquidity,
    withdrawHead: 0n,
    withdrawTail: 0n,
    status: PoolStatus.Active,
    bump: pdas.bumps.pool,
    vaultBump: pdas.bumps.vault,
    firstLossBump: pdas.bumps.firstLoss,
    reserveBump: pdas.bumps.reserve,
    shareMintBump: pdas.bumps.shareMint,
    reserved: new Uint8Array(64),
  };
  writePool(env, pdas.pool, state);
  writeTokenAccount(env, pdas.vault, env.usdcMint, pdas.pool, liquidity);
  writeTokenAccount(env, pdas.firstLoss, env.usdcMint, pdas.pool, firstLoss);
  writeTokenAccount(env, pdas.reserve, env.usdcMint, pdas.pool, reserve);
  adjustMintSupply(env, env.usdcMint, liquidity + firstLoss + reserve);
  writeMint(env, pdas.shareMint, pdas.pool, liquidity);

  return { ...pdas, params, admin, platformTreasury: state.platformTreasury };
}

/** Pool hesabını okur. */
export function readPool(env: TestEnv, pool: PublicKey): PoolState {
  const acc = env.svm.getAccount(pool);
  if (!acc) throw new Error(`Pool yok: ${pool.toBase58()}`);
  return decodePool(Buffer.from(acc.data));
}

/** Pool hesabını program sahipliğinde yazar. */
export function writePool(env: TestEnv, pool: PublicKey, state: PoolState): void {
  writeProgramAccount(env, pool, encodePool(state));
}

/** Pool alanlarını kısmi olarak günceller (fixture testleri için). */
export function patchPool(env: TestEnv, pool: PublicKey, patch: Partial<PoolState>): PoolState {
  const next = { ...readPool(env, pool), ...patch };
  writePool(env, pool, next);
  return next;
}

// ───────────────────────────── Kredi fixture'ı ─────────────────────────────

export interface LoanFixtureOptions {
  /** Kredinin durumu. Late1 / Late2 / Defaulted için kaçırılan taksit 1 / 2 / 3 olur. */
  status: LoanStatus;
  /** Ev/araç fiyatı. Varsayılan: ev 100.000, araç 20.000 USDC. */
  price?: bigint;
  /** Değer raporu. Varsayılan `price`. */
  appraisedValue?: bigint;
  /** Anapara. Varsayılan floor(min(price, value) × max_ltv). */
  principal?: bigint;
  /** Kalan anapara. Varsayılan `principal`. */
  remainingPrincipal?: bigint;
  /** Taksit. Varsayılan annüite formülü (yukarı yuvarlanmış). */
  installment?: bigint;
  /** Ödenmiş taksit sayısı. Varsayılan 0. */
  paidInstallments?: number;
  /** Kaçırılan taksit sayısı. Varsayılan duruma göre (Active 0, Late1 1, Late2 2, Defaulted 3). */
  missedInstallments?: number;
  /** Sonraki vade (unix sn). Varsayılan: Active için şimdi + 1 dönem; gecikmede kaçırılan ilk vade. */
  nextDue?: bigint;
  /** Kredi karşılığı. Varsayılan durumun `provision_bps` kademesi × kalan anapara. */
  provisionAmount?: bigint;
  /** CollateralEscrow bakiyesi. Varsayılan 3 × taksit; Late2 ve sonrası için 3 × taksit − 1 taksit. */
  collateral?: bigint;
  /** LoanEscrow bakiyesi. Varsayılan `loanEscrowExpected(...)`. */
  escrow?: bigint;
  lateFeeAccrued?: bigint;
  lastProcessedPeriod?: bigint;
  /** loan_ext.collateral_deducted. Varsayılan: Late2/Defaulted için 1 taksit, diğerleri 0. */
  collateralDeducted?: bigint;
  borrower?: PublicKey;
  seller?: PublicKey;
  /** true (varsayılan) ise havuz sayaçları da güncellenir: next_loan_id, total_outstanding, */
  /** late_default_principal, loss_provision. */
  updatePool?: boolean;
}

export interface LoanHandle extends LoanPdas {
  id: bigint;
  state: LoanState;
}

const SERVICING: LoanStatus[] = [LoanStatus.Active, LoanStatus.Late1, LoanStatus.Late2, LoanStatus.Defaulted];
const LATE: LoanStatus[] = [LoanStatus.Late1, LoanStatus.Late2, LoanStatus.Defaulted];

/**
 * Loan hesabını + LoanEscrow + CollateralEscrow token hesaplarını doğrudan yazar.
 * Kişi 1'in apply/approve/fund/confirm instruction'ları olmadan crank / repay / recovery testleri için.
 * Kredi id'si havuzun `next_loan_id`'sinden alınır.
 */
export function writeLoanFixture(env: TestEnv, pool: PoolHandle, opts: LoanFixtureOptions): LoanHandle {
  const p = readPool(env, pool.pool);
  const id = p.nextLoanId;
  const pdas = loanPdas(env.programId, pool.pool, id);
  const now = getUnixTimestamp(env);

  const price = opts.price ?? (p.assetType === AssetType.House ? 100_000n * USDC : 20_000n * USDC);
  const appraisedValue = opts.appraisedValue ?? price;
  const base = price < appraisedValue ? price : appraisedValue;
  const principal = opts.principal ?? (base * BigInt(p.maxLtvBps)) / BPS;
  const remaining = opts.remainingPrincipal ?? principal;
  const installment = opts.installment ?? annuityInstallment(principal, p.rateBps, p.termMonths);
  const missed = opts.missedInstallments ?? missedFor(opts.status);
  const isLate = LATE.includes(opts.status);
  const nextDue = opts.nextDue ?? (isLate ? now - BigInt(missed) * p.periodSeconds : now + p.periodSeconds);
  // provision_bps = [Active, Late1, Late2, Defaulted taban]. Defaulted için yalnızca taban yazılır;
  // gerçek max(taban × kalan, kalan + faiz − teminat − k × değer) hesabı crank_loan'dadır.
  const tierIdx = provisionTier(opts.status);
  const provision =
    opts.provisionAmount ?? (tierIdx === null ? 0n : (remaining * BigInt(p.provisionBps[tierIdx])) / BPS);
  const collateral = opts.collateral ?? defaultCollateral(opts.status, installment);
  const escrow = opts.escrow ?? loanEscrowExpected(opts.status, price, principal);

  const state: LoanState = {
    id,
    pool: pool.pool,
    borrower: opts.borrower ?? env.wallets.borrower1.publicKey,
    seller: opts.seller ?? env.wallets.seller.publicKey,
    price,
    appraisedValue,
    principal,
    rateBps: p.rateBps,
    installment,
    remainingPrincipal: remaining,
    paidInstallments: opts.paidInstallments ?? 0,
    missedInstallments: missed,
    nextDue,
    status: opts.status,
    docHash: new Uint8Array(32).fill(1),
    assetRefHash: new Uint8Array(32).fill(2),
    valueBand: p.assetType === AssetType.House ? 50_000n * USDC : 5_000n * USDC,
    regionCode: 1,
    incomeOk: true,
    currencyOk: true,
    provisionAmount: provision,
    lateFeeAccrued: opts.lateFeeAccrued ?? 0n,
    // crank_loan'ın en son işlediği adım = kaçırılan taksit (en fazla 3).
    lastProcessedPeriod: opts.lastProcessedPeriod ?? BigInt(Math.min(missed, 3)),
    fundedAt: now - BigInt(missed) * p.periodSeconds - p.periodSeconds,
    titleDeadline: 0n,
    bump: pdas.bumps.loan,
    escrowBump: pdas.bumps.escrow,
    collateralBump: pdas.bumps.collateral,
    // loan_ext.collateral_deducted: Late2/Defaulted'da bir taksit teminattan kesilmiştir.
    reserved: withCollateralDeducted(
      new Uint8Array(64),
      opts.collateralDeducted ??
        (opts.status === LoanStatus.Late2 || opts.status === LoanStatus.Defaulted ? installment : 0n),
    ),
  };
  writeLoan(env, pdas.loan, state);
  writeTokenAccount(env, pdas.escrow, env.usdcMint, pool.pool, escrow);
  writeTokenAccount(env, pdas.collateral, env.usdcMint, pool.pool, collateral);
  adjustMintSupply(env, env.usdcMint, escrow + collateral);

  if (opts.updatePool ?? true) {
    const outstanding = SERVICING.includes(opts.status) ? remaining : 0n;
    patchPool(env, pool.pool, {
      nextLoanId: id + 1n,
      totalOutstanding: p.totalOutstanding + outstanding,
      lateDefaultPrincipal: p.lateDefaultPrincipal + (isLate ? remaining : 0n),
      lossProvision: p.lossProvision + provision,
    });
  } else {
    patchPool(env, pool.pool, { nextLoanId: id + 1n });
  }
  return { ...pdas, id, state };
}

/**
 * `Loan.reserved` içindeki Kişi 2 alanları (lifecycle/state.rs `loan_ext`):
 * bayt 0..8 = collateral_deducted (u64 LE) — crank'in teminattan kestiği toplam.
 */
export function collateralDeducted(loan: LoanState): bigint {
  return Buffer.from(loan.reserved).readBigUInt64LE(0);
}

function withCollateralDeducted(reserved: Uint8Array, value: bigint): Uint8Array {
  const b = Buffer.from(reserved);
  b.writeBigUInt64LE(value, 0);
  return new Uint8Array(b);
}

/** `provision_bps` indeksi: Active 0, Late1 1, Late2 2, Defaulted 3; diğer durumlarda karşılık yok. */
export function provisionTier(status: LoanStatus): 0 | 1 | 2 | 3 | null {
  switch (status) {
    case LoanStatus.Active:
      return 0;
    case LoanStatus.Late1:
      return 1;
    case LoanStatus.Late2:
      return 2;
    case LoanStatus.Defaulted:
      return 3;
    default:
      return null;
  }
}

/** Teminat: 3 taksit; Late2'de bir taksit teminattan kesilmiştir; kapanmış kredilerde 0. */
function defaultCollateral(status: LoanStatus, installment: bigint): bigint {
  switch (status) {
    case LoanStatus.Pending:
    case LoanStatus.Approved:
    case LoanStatus.Funded:
    case LoanStatus.Active:
    case LoanStatus.Late1:
      return 3n * installment;
    case LoanStatus.Late2:
    case LoanStatus.Defaulted:
      return 2n * installment;
    default:
      return 0n;
  }
}

function missedFor(status: LoanStatus): number {
  switch (status) {
    case LoanStatus.Late1:
      return 1;
    case LoanStatus.Late2:
      return 2;
    case LoanStatus.Defaulted:
      return 3;
    default:
      return 0;
  }
}

/** Loan hesabını okur. */
export function readLoan(env: TestEnv, loan: PublicKey): LoanState {
  const acc = env.svm.getAccount(loan);
  if (!acc) throw new Error(`Loan yok: ${loan.toBase58()}`);
  return decodeLoan(Buffer.from(acc.data));
}

/** Loan hesabını program sahipliğinde yazar. */
export function writeLoan(env: TestEnv, loan: PublicKey, state: LoanState): void {
  writeProgramAccount(env, loan, encodeLoan(state));
}

/** Loan alanlarını kısmi olarak günceller. */
export function patchLoan(env: TestEnv, loan: PublicKey, patch: Partial<LoanState>): LoanState {
  const next = { ...readLoan(env, loan), ...patch };
  writeLoan(env, loan, next);
  return next;
}

function writeProgramAccount(env: TestEnv, address: PublicKey, data: Buffer): void {
  env.svm.setAccount(address, {
    lamports: Number(env.svm.minimumBalanceForRentExemption(BigInt(data.length))),
    data,
    owner: env.programId,
    executable: false,
  });
}

// ───────────────────────────── Kredi matematiği (yaklaşık) ─────────────────────────────

/**
 * Annüite taksidi M = P·r·(1+r)^n / ((1+r)^n − 1), yukarı yuvarlanmış micro-USDC.
 * Kişi 1'in `loanMath.installment`'ı: zincirdeki `math::installment` ile birebir aynı.
 */
export function annuityInstallment(principal: bigint, rateBps: number, termMonths: number): bigint {
  return loanMath.installment(principal, rateBps, termMonths);
}

/**
 * LoanEscrow'da olması gereken tutar (STATE.md: peşinat = price − principal, ücret = %1 anapara yukarı).
 * Pending/Approved: peşinat + ücret · Funded: + principal · diğerleri: 0.
 * VARSAYIM: Kişi 1'in `nav::loan_escrow_expected` ile teyit edilmeli.
 */
export function loanEscrowExpected(status: LoanStatus, price: bigint, principal: bigint): bigint {
  const down = price - principal;
  const fee = (principal * 100n + BPS - 1n) / BPS;
  switch (status) {
    case LoanStatus.Pending:
    case LoanStatus.Approved:
      return down + fee;
    case LoanStatus.Funded:
      return down + fee + principal;
    default:
      return 0n;
  }
}

// ───────────────────────────── Saat ─────────────────────────────

/** Şu anki zincir saati (unix sn). */
export function getUnixTimestamp(env: TestEnv): bigint {
  return env.svm.getClock().unixTimestamp;
}

/** Saati mutlak bir unix zamanına ayarlar (geri de alabilir). Slot da 1 artar. */
export function setUnixTimestamp(env: TestEnv, unixTs: bigint): void {
  const c = env.svm.getClock();
  env.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unixTs));
}

/** Saati `seconds` saniye ileri alır. Yeni zamanı döndürür. */
export function warp(env: TestEnv, seconds: bigint | number): bigint {
  const next = getUnixTimestamp(env) + BigInt(seconds);
  setUnixTimestamp(env, next);
  env.svm.expireBlockhash();
  return next;
}

/** Saati havuzun `n` dönemi (+ isteğe bağlı ek saniye) kadar ileri alır. Demo: 1 dönem = 60 sn. */
export function warpPeriods(env: TestEnv, pool: PoolHandle, n: number, extraSeconds: bigint = 0n): bigint {
  return warp(env, pool.params.periodSeconds * BigInt(n) + extraSeconds);
}

// ───────────────────────────── İşlem gönderme ─────────────────────────────

export type TxResult = TransactionMetadata;

/**
 * Instruction'ları tek bir işlemde gönderir. İlk imzacı ücreti öder.
 * Başarısızsa program loglarıyla birlikte hata fırlatır.
 */
export function sendTx(env: TestEnv, ixs: TransactionInstruction[], signers: Signer[]): TxResult {
  const res = trySendTx(env, ixs, signers);
  if (res instanceof FailedTransactionMetadata) {
    throw new Error(`İşlem başarısız: ${res.toString()}\n${res.meta().logs().join("\n")}`);
  }
  return res;
}

/** `sendTx` gibi ama hata fırlatmaz; başarısız sonucu döndürür (yetki ihlali testleri için). */
export function trySendTx(
  env: TestEnv,
  ixs: TransactionInstruction[],
  signers: Signer[],
): TransactionMetadata | FailedTransactionMetadata {
  if (signers.length === 0) throw new Error("en az bir imzacı gerekli");
  const tx = new Transaction();
  tx.recentBlockhash = env.svm.latestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.add(...ixs);
  tx.sign(...signers);
  const res = env.svm.sendTransaction(tx);
  env.svm.expireBlockhash();
  return res;
}

/**
 * İşlemin başarısız olmasını ve loglarda `expected` geçmesini bekler
 * (ör. "Unauthorized", "InvalidStatus" ya da hata kodu "0x1770").
 */
export function expectTxFail(
  env: TestEnv,
  ixs: TransactionInstruction[],
  signers: Signer[],
  expected: string,
): void {
  const res = trySendTx(env, ixs, signers);
  if (!(res instanceof FailedTransactionMetadata)) {
    throw new Error(`İşlem başarısız olmalıydı ("${expected}" bekleniyordu) ama başarılı oldu`);
  }
  const logs = res.meta().logs().join("\n");
  const err = res.toString();
  if (!logs.includes(expected) && !err.includes(expected)) {
    throw new Error(`Beklenen hata "${expected}" bulunamadı.\nHata: ${err}\nLoglar:\n${logs}`);
  }
}

// ───────────────────────────── Invariant'lar ─────────────────────────────

export interface InvariantReport {
  vault: bigint;
  idleCash: bigint;
  firstLossToken: bigint;
  firstLossBalance: bigint;
  reserveToken: bigint;
  reserveBalance: bigint;
  shareSupply: bigint;
  totalShares: bigint;
  escrows: { loan: PublicKey; status: LoanStatus; actual: bigint; expected: bigint }[];
}

/**
 * Havuz invariant'larını kontrol eder; ihlalde açıklamalı hata fırlatır. Her instruction testinin
 * sonunda çağrılır.
 *
 * 1. vault.amount ≥ pool.idle_cash           (sayaç gerçek bakiyeden büyük olamaz)
 * 2. first_loss.amount ≥ pool.first_loss_balance
 * 3. reserve.amount ≥ pool.reserve_balance
 * 4. share_mint.supply ≤ pool.total_shares   (process_withdrawals payı yakıp total_shares'ı aynı miktar düşürür)
 * 5. Verilen her kredi için LoanEscrow.amount ≥ loanEscrowExpected(status, price, principal)
 *
 * Not: Escrow'lar vault'tan ayrı token hesaplarıdır, bu yüzden vault ile değil kendi beklenen
 * tutarıyla karşılaştırılır (Rust: `assert_vault_covers_idle` + `assert_escrow_covers`).
 */
export function assertInvariants(env: TestEnv, pool: PoolHandle, loans: PublicKey[] = []): InvariantReport {
  const p = readPool(env, pool.pool);
  const report: InvariantReport = {
    vault: tokenBalance(env, pool.vault),
    idleCash: p.idleCash,
    firstLossToken: tokenBalance(env, pool.firstLoss),
    firstLossBalance: p.firstLossBalance,
    reserveToken: tokenBalance(env, pool.reserve),
    reserveBalance: p.reserveBalance,
    shareSupply: mintSupply(env, pool.shareMint),
    totalShares: p.totalShares,
    escrows: [],
  };
  const errors: string[] = [];
  if (report.vault < report.idleCash) {
    errors.push(`vault (${report.vault}) < idle_cash (${report.idleCash})`);
  }
  if (report.firstLossToken < report.firstLossBalance) {
    errors.push(`first_loss token (${report.firstLossToken}) < first_loss_balance (${report.firstLossBalance})`);
  }
  if (report.reserveToken < report.reserveBalance) {
    errors.push(`reserve token (${report.reserveToken}) < reserve_balance (${report.reserveBalance})`);
  }
  if (report.shareSupply > report.totalShares) {
    errors.push(`share supply (${report.shareSupply}) > total_shares (${report.totalShares})`);
  }
  for (const loanKey of loans) {
    const l = readLoan(env, loanKey);
    if (!l.pool.equals(pool.pool)) errors.push(`kredi ${l.id} başka havuza ait`);
    const { escrow } = loanPdas(env.programId, pool.pool, l.id);
    const actual = tokenBalanceOrZero(env, escrow);
    const expected = loanEscrowExpected(l.status, l.price, l.principal);
    report.escrows.push({ loan: loanKey, status: l.status, actual, expected });
    if (actual < expected) {
      errors.push(`kredi ${l.id} (${LoanStatus[l.status]}) escrow ${actual} < beklenen ${expected}`);
    }
  }
  if (errors.length > 0) throw new Error(`Invariant ihlali:\n  - ${errors.join("\n  - ")}`);
  return report;
}

// ───────────────────────────── Instruction oluşturucular ─────────────────────────────
// Hepsi `accountsStrict` kullanır: IDL'de hesap adı değişirse test derlenmez/düşer, sessizce
// yanlış hesap çözülmez.

function requireProgram(env: TestEnv): Program {
  if (!env.program) throw new Error("IDL yok: önce 'npm run build' çalıştırın.");
  return env.program;
}

/** crank_loan (izinsiz). */
export function crankLoanIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  cranker: PublicKey = env.wallets.stranger.publicKey,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { collateral } = loanPdas(env.programId, pool.pool, l.id);
  return requireProgram(env)
    .methods.crankLoan()
    .accountsStrict({
      cranker,
      pool: pool.pool,
      loan,
      collateral,
      vault: pool.vault,
      reserve: pool.reserve,
      platformTreasury: pool.platformTreasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** repay(amount). `payerUsdc` varsayılan: payer'ın USDC ATA'sı. */
export function repayIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  amount: bigint,
  payer: PublicKey = env.wallets.borrower1.publicKey,
  payerUsdc: PublicKey = usdcAta(env, payer),
): Promise<TransactionInstruction> {
  return requireProgram(env)
    .methods.repay(new BN(amount.toString()))
    .accountsStrict({
      payer,
      pool: pool.pool,
      loan,
      payerUsdc,
      vault: pool.vault,
      reserve: pool.reserve,
      platformTreasury: pool.platformTreasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/**
 * record_recovery(proceeds). Yetkili: env.recoveryAgent. Gelir `recoverySource`'tan çekilir
 * (varsayılan ajanın USDC ATA'sı). `coSigner` alt sınırın altındaki gelir için (pool.admin).
 */
export function recordRecoveryIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  proceeds: bigint,
  opts: { recoveryAgent?: PublicKey; recoverySource?: PublicKey; coSigner?: PublicKey | null } = {},
): Promise<TransactionInstruction> {
  const agent = opts.recoveryAgent ?? env.recoveryAgent.publicKey;
  const l = readLoan(env, loan);
  const { collateral } = loanPdas(env.programId, pool.pool, l.id);
  return requireProgram(env)
    .methods.recordRecovery(new BN(proceeds.toString()))
    .accountsStrict({
      recoveryAgent: agent,
      // Opsiyonel hesap: null = verilmedi. Tipsiz IDL'de TS null'a izin vermiyor; Anchor
      // çalışma zamanında null'u "hesap yok" olarak kodlar.
      coSigner: (opts.coSigner ?? null) as unknown as PublicKey,
      pool: pool.pool,
      loan,
      recoverySource: opts.recoverySource ?? usdcAta(env, agent),
      vault: pool.vault,
      collateral,
      firstLoss: pool.firstLoss,
      reserve: pool.reserve,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** lifecycle/waterfall.rs `apply_waterfall`'ın birebir TS karşılığı. */
export function waterfall(i: {
  remainingPrincipal: bigint;
  accruedInterest: bigint;
  lateFees: bigint;
  collateral: bigint;
  proceeds: bigint;
  firstLossAvailable: bigint;
  reserveAvailable: bigint;
}) {
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const claim = i.remainingPrincipal + i.accruedInterest + i.lateFees;
  const collateralUsed = min(i.collateral, claim);
  let open = claim - collateralUsed;
  const proceedsUsed = min(i.proceeds, open);
  open -= proceedsUsed;
  const loss = open;
  const firstLossUsed = min(i.firstLossAvailable, open);
  open -= firstLossUsed;
  const reserveUsed = min(i.reserveAvailable, open);
  open -= reserveUsed;
  return {
    claim,
    collateralUsed,
    proceedsUsed,
    surplus: i.collateral - collateralUsed + (i.proceeds - proceedsUsed),
    loss,
    firstLossUsed,
    reserveUsed,
    seniorLoss: open,
  };
}

/** `owner`'ın pay (share) ATA'sı; yoksa 0 bakiyeyle oluşturur. */
export function ensureShareAta(env: TestEnv, pool: PoolHandle, owner: PublicKey): PublicKey {
  const ata = getAssociatedTokenAddressSync(pool.shareMint, owner, true);
  if (!env.svm.getAccount(ata)) writeTokenAccount(env, ata, pool.shareMint, owner, 0n);
  return ata;
}

/** deposit(amount) — Kişi 1. Yatırımcının USDC ve pay ATA'ları kullanılır (pay ATA'sı yoksa açılır). */
export function depositIx(
  env: TestEnv,
  pool: PoolHandle,
  depositor: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction> {
  return requireProgram(env)
    .methods.deposit(new BN(amount.toString()))
    .accountsStrict({
      depositor,
      pool: pool.pool,
      depositorUsdc: usdcAta(env, depositor),
      vault: pool.vault,
      shareMint: pool.shareMint,
      depositorShares: ensureShareAta(env, pool, depositor),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** Kilitli payların durduğu havuz hesabı: ["share_escrow", pool]. */
export function shareEscrowPda(env: TestEnv, pool: PoolHandle): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("share_escrow"), pool.pool.toBuffer()], env.programId)[0];
}

/** request_withdraw(shares). Ödeme hedefi varsayılan olarak sahibin USDC ATA'sı. */
export function requestWithdrawIx(
  env: TestEnv,
  pool: PoolHandle,
  owner: PublicKey,
  shares: bigint,
  destination: PublicKey = ensureUsdcAta(env, owner),
): Promise<TransactionInstruction> {
  const seq = readPool(env, pool.pool).withdrawTail;
  return requireProgram(env)
    .methods.requestWithdraw(new BN(shares.toString()))
    .accountsStrict({
      owner,
      pool: pool.pool,
      shareMint: pool.shareMint,
      ownerShares: ensureShareAta(env, pool, owner),
      destination,
      shareEscrow: shareEscrowPda(env, pool),
      withdrawRequest: withdrawRequestPda(env.programId, pool.pool, seq),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: new PublicKey("11111111111111111111111111111111"),
    })
    .instruction();
}

export interface WithdrawRequestState {
  pool: PublicKey;
  owner: PublicKey;
  destination: PublicKey;
  seq: bigint;
  shares: bigint;
  createdAt: bigint;
  bump: number;
}

/** WithdrawRequest hesabını okur; kapalıysa null. */
export function readWithdrawRequest(env: TestEnv, address: PublicKey): WithdrawRequestState | null {
  const acc = env.svm.getAccount(address);
  if (!acc || acc.data.length === 0) return null;
  const b = Buffer.from(acc.data);
  return {
    pool: new PublicKey(b.subarray(8, 40)),
    owner: new PublicKey(b.subarray(40, 72)),
    destination: new PublicKey(b.subarray(72, 104)),
    seq: b.readBigUInt64LE(104),
    shares: b.readBigUInt64LE(112),
    createdAt: b.readBigInt64LE(120),
    bump: b.readUInt8(128),
  };
}

/** Kuyruk başından en fazla `max` talebin [request, destination, owner] üçlüsü. */
export function pendingWithdrawals(env: TestEnv, pool: PoolHandle, max = 3) {
  const p = readPool(env, pool.pool);
  const out: { request: PublicKey; destination: PublicKey; owner: PublicKey }[] = [];
  for (let seq = p.withdrawHead; seq < p.withdrawTail && out.length < max; seq++) {
    const request = withdrawRequestPda(env.programId, pool.pool, seq);
    const r = readWithdrawRequest(env, request);
    if (!r) throw new Error(`talep ${seq} yok`);
    out.push({ request, destination: r.destination, owner: r.owner });
  }
  return out;
}

/** process_withdrawals (izinsiz). `entries` varsayılan: kuyruk başından en fazla 3 talep. */
export function processWithdrawalsIx(
  env: TestEnv,
  pool: PoolHandle,
  entries = pendingWithdrawals(env, pool),
  cranker: PublicKey = env.wallets.stranger.publicKey,
): Promise<TransactionInstruction> {
  return requireProgram(env)
    .methods.processWithdrawals()
    .accountsStrict({
      cranker,
      pool: pool.pool,
      vault: pool.vault,
      shareMint: pool.shareMint,
      shareEscrow: shareEscrowPda(env, pool),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .remainingAccounts(
      entries.flatMap((e) => [
        { pubkey: e.request, isSigner: false, isWritable: true },
        { pubkey: e.destination, isSigner: false, isWritable: true },
        { pubkey: e.owner, isSigner: false, isWritable: true },
      ]),
    )
    .instruction();
}

/** payoff() — yalnızca borçlu. Ödeme ve teminat iadesi borçlunun USDC ATA'sı üzerinden. */
export function payoffIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  borrower: PublicKey = readLoan(env, loan).borrower,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { collateral } = loanPdas(env.programId, pool.pool, l.id);
  return requireProgram(env)
    .methods.payoff()
    .accountsStrict({
      borrower,
      pool: pool.pool,
      loan,
      borrowerUsdc: ensureUsdcAta(env, borrower),
      vault: pool.vault,
      reserve: pool.reserve,
      platformTreasury: pool.platformTreasury,
      collateral,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/** fund_loan (Kişi 1, izinsiz) — fren testleri için. */
export function fundLoanIx(
  env: TestEnv,
  pool: PoolHandle,
  loan: PublicKey,
  caller: PublicKey = env.wallets.stranger.publicKey,
): Promise<TransactionInstruction> {
  const l = readLoan(env, loan);
  const { escrow } = loanPdas(env.programId, pool.pool, l.id);
  return requireProgram(env)
    .methods.fundLoan()
    .accountsStrict({
      caller,
      pool: pool.pool,
      loan,
      vault: pool.vault,
      loanEscrow: escrow,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

// ───────────────────────────── IDL ─────────────────────────────

function readIdl(): (Idl & { address: string }) | null {
  const p = path.join(ROOT, "target", "idl", "glasshouse.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
