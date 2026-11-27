// Demo seed script'i — SAHİBİ: Kişi 2. Çıktıyı Kişi 3 (frontend) okur: scripts/out/seed-addresses.json
//
// Ne yapar (gerçek zincir işlemleri; devnet ya da yerel doğrulayıcı):
//   1. Sahte USDC mint'ini (yoksa) kurar, 10 demo cüzdanını hazırlar (SOL + mock USDC). Gizli anahtarlar
//      .keys/ altına yazılır (.gitignore'da; ASLA commit/paylaşım).
//   2. Ev havuzu (LTV %70, faiz %7, 240 ay) ve araç havuzu (LTV %60, faiz %9, 60 ay, recovery_coeff 5400)
//      kurar (period 60 sn, grace 10 sn), ilk zarar kasalarını doldurur, yatırımcıları yatırır.
//   3. 10 ev + 3 araç kredisini GERÇEK akışla açar (apply → approve → fund → confirm_title) ve
//      durumlara getirir: ev = 6 Active, 1 PaidOff, 2 Late1, 1 Defaulted; araç = 3 Active.
//   4. scripts/out/seed-addresses.json yazar (yalnızca PUBLIC key'ler).
//
// Güvenlik: varsayılan DRY-RUN (zincire yazmaz, planı yazdırır). Zincire yazmak için --execute.
// Tekrar çalıştırılabilir: var olan mint/cüzdan/havuz/krediyi atlar, eksiği tamamlar.
// --reset: eski seed durumunu temizler (çıktı dosyası silinir) ve YENİ bir havuz kuşağı başlatır
// (zincirde havuz silinemez; eski havuzlar kalır, JSON yenilerini gösterir). Cüzdanlar korunur.
//
// Çalıştırma:
//   export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com   # ya da http://127.0.0.1:8899
//   export ANCHOR_WALLET=<deployer.json>                       # mint yetkilisi + SOL kaynağı
//   npx ts-node -P scripts/tsconfig.json scripts/seed.ts                   # dry-run
//   npx ts-node -P scripts/tsconfig.json scripts/seed.ts --execute
//   npx ts-node -P scripts/tsconfig.json scripts/seed.ts --execute --reset
//
// Süre: gecikme durumları GERÇEK zamanla oluşur (period 60 sn, grace 10 sn): Late1 için ≈ 70 sn,
// Defaulted için ≈ 190 sn beklenir; toplam birkaç dakika sürer.

import { BN } from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotent,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  args,
  DEPLOY_FILE,
  EXECUTE,
  getProgram,
  getProvider,
  KEYS_DIR,
  loadOrCreateKeypair,
  log,
  pk,
  readDeployment,
  ROLES,
  Role,
  ROOT,
  USDC,
  writeDeployment,
} from "./lib";

const RESET = args.has("--reset");
const OUT_DIR = path.join(ROOT, "scripts", "out");
const OUT_FILE = path.join(OUT_DIR, "seed-addresses.json");
/** Havuz kuşağı sayacı (yerel; .keys altında, gitignore'da). */
const STATE_FILE = path.join(KEYS_DIR, "seed-state.json");

// ───────────────────────────── Sabit seed planı ─────────────────────────────

const PERIOD = 60;
const GRACE = 10;

/** Hedef durum: Active / PaidOff / Late1 / Defaulted. */
type Target = "Active" | "PaidOff" | "Late1" | "Defaulted";
type PoolName = "house" | "vehicle";

interface LoanPlan {
  pool: PoolName;
  /** USD cinsinden fiyat (ekspertiz = fiyat). */
  price: number;
  target: Target;
}

/**
 * SIRA ÖNEMLİ (kredi id'leri havuz sayacından, sırayla): Defaulted ve PaidOff önce, Late1'ler EN SON
 * oluşturulur; çünkü Late1 yalnızca [vade+grace, vade+grace+period) penceresinde crank'lenirse
 * Late1 kalır (sonra Late2'ye geçer). Araç kredileri Late1'lerden önce açılır.
 */
const LOANS: LoanPlan[] = [
  { pool: "house", price: 120_000, target: "Defaulted" }, // ev id 0
  { pool: "house", price: 95_000, target: "PaidOff" }, // ev id 1
  { pool: "house", price: 150_000, target: "Active" }, // ev id 2
  { pool: "house", price: 80_000, target: "Active" },
  { pool: "house", price: 110_000, target: "Active" },
  { pool: "house", price: 70_000, target: "Active" },
  { pool: "house", price: 100_000, target: "Active" },
  { pool: "house", price: 85_000, target: "Active" }, // ev id 7
  { pool: "vehicle", price: 20_000, target: "Active" }, // araç id 0
  { pool: "vehicle", price: 25_000, target: "Active" },
  { pool: "vehicle", price: 18_000, target: "Active" }, // araç id 2
  { pool: "house", price: 130_000, target: "Late1" }, // ev id 8
  { pool: "house", price: 90_000, target: "Late1" }, // ev id 9
];

/** create-pools.ts ile aynı ürün değerleri (karar 2). poolId kuşağa göre değişir. */
const POOL_CFG = {
  house: {
    baseId: 1,
    assetType: { house: {} },
    maxLtvBps: 7000,
    rateBps: 700,
    termMonths: 240,
    recoveryCoeffBps: 6300,
    borrower: "borrowerMaria" as Role,
    firstLoss: 50_000n * USDC,
    // 10 ev kredisi ≈ 721.000 USD anapara; likidite tamponu (%10) için yatırım ≥ ≈ 810.000 gerekir.
    deposits: { investorA: 500_000n * USDC, investorB: 400_000n * USDC },
  },
  vehicle: {
    baseId: 2,
    assetType: { vehicle: {} },
    maxLtvBps: 6000,
    rateBps: 900,
    termMonths: 60,
    recoveryCoeffBps: 5400,
    borrower: "borrowerDiego" as Role,
    firstLoss: 5_000n * USDC,
    deposits: { investorA: 60_000n * USDC, investorB: 40_000n * USDC },
  },
} as const;

const COMMON = {
  provisionBps: [0, 500, 1500, 1500],
  bufferBps: 1000,
  brakeLateBps: 1000,
  brakeReserveBps: 25,
  minFirstLossBps: 500,
  entryExitFeeBps: 20,
  minRecoveryBps: 5000,
  titleTimeoutSeconds: 3600,
};

/** Cüzdan başına hedef SOL ve mock USDC (create-wallets.ts ile uyumlu; seed için yeterli). */
const SOL_TARGET: Record<Role, number> = {
  platform: 1.0,
  underwriter: 0.2,
  titleAgent: 0.2,
  recoveryAgent: 0.2,
  crank: 0.3,
  seller: 0.1,
  investorA: 0.2,
  investorB: 0.2,
  borrowerMaria: 0.4,
  borrowerDiego: 0.3,
};
const USDC_TARGET: Record<Role, bigint> = {
  platform: 100_000n * USDC,
  investorA: 1_000_000n * USDC,
  investorB: 1_000_000n * USDC,
  borrowerMaria: 500_000n * USDC,
  borrowerDiego: 100_000n * USDC,
  recoveryAgent: 100_000n * USDC,
  seller: 0n,
  underwriter: 0n,
  titleAgent: 0n,
  crank: 0n,
};

// ───────────────────────────── Yardımcılar ─────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bn = (v: bigint | number) => new BN(v.toString());
const num = (b: any): number => Number(b.toString());
const big = (b: any): bigint => BigInt(b.toString());
const statusName = (s: any): string => Object.keys(s)[0];

function u64le(v: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

function salted(label: string): number[] {
  return Array.from(crypto.createHash("sha256").update(`glasshouse-seed:${label}`).digest());
}

/** Zincir saati (yoksa yerel saat). Gecikme penceresi bu saate göre hesaplanır. */
async function chainNow(conn: any): Promise<number> {
  try {
    const t = await conn.getBlockTime(await conn.getSlot("confirmed"));
    if (t) return t;
  } catch {
    /* yerel saate düş */
  }
  return Math.floor(Date.now() / 1000);
}

async function waitUntil(conn: any, ts: number, why: string) {
  for (;;) {
    const now = await chainNow(conn);
    if (now >= ts) return;
    const left = ts - now;
    process.stdout.write(`\r  bekleniyor: ${why} (${left} sn)   `);
    await sleep(Math.min(left, 5) * 1000);
  }
}

async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      last = e;
      const m = String(e?.message ?? e);
      if (!/blockhash|timeout|429|fetch failed|ECONN|Node is behind/i.test(m)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  throw last;
}

const isLocalRpc = (rpc: string): boolean => /localhost|127\.0\.0\.1|\[::1\]/.test(rpc);

/**
 * Explorer linki. Yerel doğrulayıcıda custom URL; diğer her durumda devnet. Özel RPC adresi (API anahtarı
 * içerebilir) ASLA linke ya da çıktıya yazılmaz.
 */
function explorer(rpc: string, addr: string): string {
  const base = `https://explorer.solana.com/address/${addr}`;
  if (isLocalRpc(rpc)) return `${base}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
  return `${base}?cluster=devnet`;
}

function readGeneration(): number {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")).generation ?? 0;
  } catch {
    return 0;
  }
}
function writeGeneration(g: number) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ generation: g }), { mode: 0o600 });
}
const poolIdFor = (name: PoolName, generation: number) =>
  generation === 0 ? POOL_CFG[name].baseId : generation * 1000 + POOL_CFG[name].baseId;

// ───────────────────────────── Plan (dry-run) ─────────────────────────────

function printPlan(generation: number) {
  console.log("\nPLAN (zincire yazılmaz; yazmak için --execute):");
  console.log("  1. mock USDC mint (yoksa) + 10 cüzdan: SOL ve USDC hedefleri aşağıda");
  for (const r of ROLES) {
    console.log(`     ${r.padEnd(14)} ${SOL_TARGET[r]} SOL, ${USDC_TARGET[r] / USDC} USDC`);
  }
  for (const name of ["house", "vehicle"] as PoolName[]) {
    const c = POOL_CFG[name];
    console.log(
      `  2. ${name} havuzu id ${poolIdFor(name, generation)}: LTV %${c.maxLtvBps / 100} faiz %${c.rateBps / 100} ` +
        `vade ${c.termMonths} ay, period ${PERIOD}s grace ${GRACE}s; ilk zarar kasası ${c.firstLoss / USDC} USDC; ` +
        `yatırım ${Object.entries(c.deposits)
          .map(([k, v]) => `${k} ${v / USDC}`)
          .join(", ")} USDC`,
    );
  }
  console.log(`  3. ${LOANS.length} kredi (gerçek akış: apply → approve → fund → confirm_title):`);
  LOANS.forEach((l, i) => console.log(`     #${i + 1} ${l.pool.padEnd(7)} ${String(l.price).padStart(7)} USD → ${l.target}`));
  console.log("  4. Late1 / Defaulted için ≈ 70 / ≈ 190 sn gerçek zaman beklenir");
  console.log(`  5. ${path.relative(ROOT, OUT_FILE)} yazılır (yalnızca public key'ler)`);
  if (RESET) console.log("  (--reset: yeni havuz kuşağı + eski çıktı silinir)");
}

// ───────────────────────────── Ana akış ─────────────────────────────

async function main() {
  const provider = getProvider();
  const conn = provider.connection;
  const rpc = conn.rpcEndpoint;
  const payer: Keypair = (provider.wallet as any).payer;
  const program: any = getProgram(provider);

  let generation = readGeneration();
  if (RESET) generation += 1;
  if (!EXECUTE) {
    printPlan(generation);
    return;
  }
  if (/mainnet/i.test(rpc)) throw new Error("mainnet'e seed atılmaz.");

  if (RESET) {
    if (fs.existsSync(OUT_FILE)) fs.rmSync(OUT_FILE);
    writeGeneration(generation);
    console.log(`--reset: eski çıktı silindi, havuz kuşağı = ${generation}`);
  }

  // ---- 1) mint ----
  const d = readDeployment();
  d.cluster = isLocalRpc(rpc) ? "localnet" : "devnet"; // RPC adresi (API anahtarı içerebilir) dosyaya yazılmaz
  let usdcMint: PublicKey;
  if (d.usdcMint && (await conn.getAccountInfo(pk(d.usdcMint)))) {
    usdcMint = pk(d.usdcMint);
    log(`usdc mint mevcut: ${usdcMint.toBase58()}`);
  } else {
    usdcMint = await retry(() => createMint(conn, payer, payer.publicKey, null, 6));
    d.usdcMint = usdcMint.toBase58();
    d.wallets = {};
    d.pools = {};
    log(`usdc mint oluşturuldu: ${usdcMint.toBase58()}`);
  }

  // ---- 2) cüzdanlar ----
  const kp = {} as Record<Role, Keypair>;
  const ata = {} as Record<Role, PublicKey>;
  for (const role of ROLES) {
    // devnet.json'da bu rol için cüzdan kayıtlıysa (örn. Kişi 1'in create-wallets çıktısı), havuzların rolleri
    // zincirde O cüzdanlara sabitlenmiştir: approve/confirm/crank için o gizli anahtarlar gerekir.
    // Yanlış (yeni) bir anahtar üretip sessizce devam etmek yerine dur.
    const known = d.wallets[role]?.pubkey;
    if (known && !fs.existsSync(path.join(KEYS_DIR, `${role}.json`))) {
      throw new Error(
        `${role}: deployments/devnet.json'da kayıtlı cüzdan ${known}, ama .keys/${role}.json yok. ` +
          `Bu anahtarlar create-wallets.ts'i çalıştıranın makinesindedir (.keys/, paylaşılmaz). Seed'i o kişi çalıştırsın ` +
          `ya da .keys/ klasörü güvenli bir kanaldan (commit ETMEDEN) aktarılsın.`,
      );
    }
    const { kp: k, created } = loadOrCreateKeypair(role);
    if (known && known !== k.publicKey.toBase58()) {
      throw new Error(`${role}: .keys/${role}.json (${k.publicKey.toBase58()}) devnet.json'daki cüzdanla (${known}) uyuşmuyor.`);
    }
    kp[role] = k;
    const target = Math.round(SOL_TARGET[role] * LAMPORTS_PER_SOL);
    const have = await conn.getBalance(k.publicKey);
    if (have < target) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: target - have }),
      );
      await retry(() => sendAndConfirmTransaction(conn, tx, [payer]));
    }
    const acc = await retry(() => getOrCreateAssociatedTokenAccount(conn, payer, usdcMint, k.publicKey));
    ata[role] = acc.address;
    if (acc.amount < USDC_TARGET[role]) {
      await retry(() => mintTo(conn, payer, usdcMint, acc.address, payer, USDC_TARGET[role] - acc.amount));
    }
    d.wallets[role] = { pubkey: k.publicKey.toBase58(), usdc: acc.address.toBase58() };
    log(`${role.padEnd(14)} ${k.publicKey.toBase58()} ${created ? "(yeni anahtar)" : ""}`);
  }
  writeDeployment(d);

  // ---- 3) havuzlar ----
  const platform = kp.platform;
  const pools = {} as Record<PoolName, any>;
  for (const name of ["house", "vehicle"] as PoolName[]) {
    const cfg = POOL_CFG[name];
    const poolId = poolIdFor(name, generation);
    const [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), platform.publicKey.toBuffer(), u64le(poolId)],
      program.programId,
    );
    const sub = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s), pool.toBuffer()], program.programId)[0];
    const a = { pool, vault: sub("vault"), firstLoss: sub("first_loss"), reserve: sub("reserve"), shareMint: sub("shares") };

    if (!(await conn.getAccountInfo(pool))) {
      await retry(() =>
        program.methods
          .createPool({
            poolId: bn(poolId),
            assetType: cfg.assetType,
            underwriter: kp.underwriter.publicKey,
            titleAgent: kp.titleAgent.publicKey,
            recoveryAgent: kp.recoveryAgent.publicKey,
            maxLtvBps: cfg.maxLtvBps,
            rateBps: cfg.rateBps,
            termMonths: cfg.termMonths,
            recoveryCoeffBps: cfg.recoveryCoeffBps,
            graceSeconds: bn(GRACE),
            periodSeconds: bn(PERIOD),
            provisionBps: [...COMMON.provisionBps],
            bufferBps: COMMON.bufferBps,
            brakeLateBps: COMMON.brakeLateBps,
            brakeReserveBps: COMMON.brakeReserveBps,
            minFirstLossBps: COMMON.minFirstLossBps,
            entryExitFeeBps: COMMON.entryExitFeeBps,
            minRecoveryBps: COMMON.minRecoveryBps,
            titleTimeoutSeconds: bn(COMMON.titleTimeoutSeconds),
          })
          .accountsPartial({
            admin: platform.publicKey,
            pool,
            usdcMint,
            platformTreasury: ata.platform,
            vault: a.vault,
            firstLossVault: a.firstLoss,
            reserveVault: a.reserve,
            shareMint: a.shareMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([platform])
          .rpc(),
      );
      log(`${name} havuzu kuruldu (id ${poolId}): ${pool.toBase58()}`);
    } else {
      log(`${name} havuzu mevcut (id ${poolId}): ${pool.toBase58()}`);
    }

    // ilk zarar kasası
    let p = await program.account.pool.fetch(pool);
    const flBal = big(p.firstLossBalance);
    if (flBal < cfg.firstLoss) {
      await retry(() =>
        program.methods
          .fundFirstLoss(bn(cfg.firstLoss - flBal))
          .accountsPartial({
            admin: platform.publicKey,
            pool,
            adminTokenAccount: ata.platform,
            firstLossVault: a.firstLoss,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([platform])
          .rpc(),
      );
      log(`  ${name}: ilk zarar kasası ${cfg.firstLoss / USDC} USDC`);
    }

    // yatırımcılar (pay hesabı boşsa yatır)
    for (const [role, amount] of Object.entries(cfg.deposits) as [Role, bigint][]) {
      const sharesAta = await retry(() =>
        createAssociatedTokenAccountIdempotent(conn, payer, a.shareMint, kp[role].publicKey),
      );
      const held = (await getAccount(conn, sharesAta)).amount;
      // Pay fiyatı ≈ 1,0: yatırım hedefin %90'ından azsa farkı yatır (havuz önceden küçük bir yatırımla
      // kurulmuş olabilir). Yeterliyse atla; böylece tekrar çalıştırmada çifte yatırım olmaz.
      if (held < (amount * 9n) / 10n) {
        const topUp = amount - held;
        await retry(() =>
          program.methods
            .deposit(bn(topUp))
            .accountsPartial({
              depositor: kp[role].publicKey,
              pool,
              depositorUsdc: ata[role],
              vault: a.vault,
              shareMint: a.shareMint,
              depositorShares: sharesAta,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([kp[role]])
            .rpc(),
        );
        log(`  ${name}: ${role} ${topUp / USDC} USDC yatırdı`);
      }
    }
    p = await program.account.pool.fetch(pool);
    pools[name] = { poolId, ...a, state: p };
    d.pools[name] = {
      poolId,
      admin: platform.publicKey.toBase58(),
      pool: pool.toBase58(),
      vault: a.vault.toBase58(),
      firstLossVault: a.firstLoss.toBase58(),
      reserveVault: a.reserve.toBase58(),
      shareMint: a.shareMint.toBase58(),
      platformTreasury: ata.platform.toBase58(),
      assetType: name,
      maxLtvBps: cfg.maxLtvBps,
      rateBps: cfg.rateBps,
      termMonths: cfg.termMonths,
      recoveryCoeffBps: cfg.recoveryCoeffBps,
      periodSeconds: PERIOD,
      graceSeconds: GRACE,
    };
  }
  writeDeployment(d);

  // ---- 4) krediler (gerçek akış) ----
  const loanPdas = (pool: PublicKey, id: number) => {
    const [loan] = PublicKey.findProgramAddressSync([Buffer.from("loan"), pool.toBuffer(), u64le(id)], program.programId);
    const [escrow] = PublicKey.findProgramAddressSync([Buffer.from("escrow"), loan.toBuffer()], program.programId);
    const [collateral] = PublicKey.findProgramAddressSync([Buffer.from("collateral"), loan.toBuffer()], program.programId);
    return { loan, escrow, collateral };
  };

  const seq: Record<PoolName, number> = { house: 0, vehicle: 0 };
  const created: { plan: LoanPlan; id: number; pool: PoolName }[] = [];
  for (const plan of LOANS) {
    const id = seq[plan.pool]++;
    created.push({ plan, id, pool: plan.pool });
    const cfg = POOL_CFG[plan.pool];
    const P = pools[plan.pool];
    const { loan, escrow, collateral } = loanPdas(P.pool, id);
    const borrower = kp[cfg.borrower];
    const priceMicro = BigInt(plan.price) * USDC;

    // Hesap yoksa başvur; varsa kaldığı yerden devam et.
    if (!(await conn.getAccountInfo(loan))) {
      const nextId = num((await program.account.pool.fetch(P.pool)).nextLoanId);
      if (nextId !== id) throw new Error(`${plan.pool} havuzunda beklenen kredi id ${id}, zincirde ${nextId}. --reset ile temiz başla.`);
      const principal = (priceMicro * BigInt(cfg.maxLtvBps)) / 10_000n;
      const down = priceMicro - principal;
      await retry(() =>
        program.methods
          .applyLoan(bn(priceMicro), bn(down))
          .accountsPartial({
            borrower: borrower.publicKey,
            seller: kp.seller.publicKey,
            pool: P.pool,
            loan,
            usdcMint,
            borrowerUsdc: ata[cfg.borrower],
            loanEscrow: escrow,
            collateralEscrow: collateral,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([borrower, kp.seller])
          .rpc(),
      );
    }
    // Active'e kadar ilerlet.
    for (;;) {
      const st = statusName((await program.account.loan.fetch(loan)).status);
      if (st === "pending") {
        await retry(() =>
          program.methods
            .approveLoan(
              { approve: {} },
              bn(priceMicro),
              salted(`${generation}:${plan.pool}:${id}:doc`),
              salted(`${generation}:${plan.pool}:${id}:asset`),
              plan.pool === "house" ? 4034 : 3406, // şehir düzeyi bölge kodu (kişisel veri değil)
              true,
              true,
            )
            .accountsPartial({
              underwriter: kp.underwriter.publicKey,
              pool: P.pool,
              loan,
              borrower: borrower.publicKey,
              borrowerUsdc: ata[cfg.borrower],
              loanEscrow: escrow,
              collateralEscrow: collateral,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([kp.underwriter])
            .rpc(),
        );
      } else if (st === "approved") {
        await retry(() =>
          program.methods
            .fundLoan()
            .accountsPartial({
              caller: kp.crank.publicKey,
              pool: P.pool,
              loan,
              vault: P.vault,
              loanEscrow: escrow,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([kp.crank])
            .rpc(),
        );
      } else if (st === "funded") {
        await retry(() =>
          program.methods
            .confirmTitle()
            .accountsPartial({
              titleAgent: kp.titleAgent.publicKey,
              pool: P.pool,
              loan,
              loanEscrow: escrow,
              sellerUsdc: ata.seller,
              reserveVault: P.reserve,
              platformTreasury: ata.platform,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([kp.titleAgent])
            .rpc(),
        );
      } else {
        break; // active ve sonrası
      }
    }
    log(`  ${plan.pool} #${id} (${plan.price} USD) hazır`);
  }

  // ---- 5) durumlar ----
  const warnings: string[] = [];
  const loanState = async (c: { id: number; pool: PoolName }) => {
    const pdas = loanPdas(pools[c.pool].pool, c.id);
    return { ...pdas, data: await program.account.loan.fetch(pdas.loan) };
  };
  const crank = async (c: { id: number; pool: PoolName }) => {
    const L = await loanState(c);
    await retry(() =>
      program.methods
        .crankLoan()
        .accountsPartial({
          cranker: kp.crank.publicKey,
          pool: pools[c.pool].pool,
          loan: L.loan,
          collateral: L.collateral,
          vault: pools[c.pool].vault,
          reserve: pools[c.pool].reserve,
          platformTreasury: ata.platform,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp.crank])
        .rpc(),
    );
  };

  // PaidOff: cezasız erken kapama.
  for (const c of created.filter((x) => x.plan.target === "PaidOff")) {
    const L = await loanState(c);
    if (statusName(L.data.status) === "active") {
      const cfg = POOL_CFG[c.pool];
      await retry(() =>
        program.methods
          .payoff()
          .accountsPartial({
            borrower: kp[cfg.borrower].publicKey,
            pool: pools[c.pool].pool,
            loan: L.loan,
            borrowerUsdc: ata[cfg.borrower],
            vault: pools[c.pool].vault,
            reserve: pools[c.pool].reserve,
            platformTreasury: ata.platform,
            collateral: L.collateral,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([kp[cfg.borrower]])
          .rpc(),
      );
      log(`  ${c.pool} #${c.id}: PaidOff`);
    }
  }

  // Late1: pencere [vade+grace, vade+grace+period). Hepsi için son vadeden sonra bekle, hemen crank'le.
  const late1 = created.filter((x) => x.plan.target === "Late1");
  if (late1.length) {
    const pending = [];
    for (const c of late1) {
      const L = await loanState(c);
      if (statusName(L.data.status) === "active") pending.push({ c, due: num(L.data.nextDue) });
    }
    if (pending.length) {
      const lastDue = Math.max(...pending.map((x) => x.due));
      await waitUntil(conn, lastDue + GRACE + 2, "Late1 penceresi");
      console.log();
      for (const { c, due } of pending) {
        const now = await chainNow(conn);
        const missed = Math.floor((now - due - GRACE) / PERIOD) + 1;
        if (missed !== 1) warnings.push(`${c.pool} #${c.id}: Late1 penceresi kaçtı (kaçırılan ${missed}); --reset ile yeniden dene.`);
        await crank(c);
        log(`  ${c.pool} #${c.id}: crank → Late1`);
      }
    }
  }

  // Defaulted: 3 taksit + grace dolunca crank (üst sınır 3, geç kalmak zarar vermez).
  for (const c of created.filter((x) => x.plan.target === "Defaulted")) {
    const L = await loanState(c);
    if (statusName(L.data.status) !== "defaulted") {
      await waitUntil(conn, num(L.data.nextDue) + GRACE + 2 * PERIOD + 2, "Defaulted süresi");
      console.log();
      await crank(c);
      log(`  ${c.pool} #${c.id}: crank → Defaulted`);
    }
  }

  // ---- 6) çıktı ----
  const out: any = {
    generatedAt: new Date().toISOString(),
    cluster: isLocalRpc(rpc) ? "localnet" : "devnet",
    generation,
    programId: program.programId.toBase58(),
    usdcMint: usdcMint.toBase58(),
    explorer: { programId: explorer(rpc, program.programId.toBase58()), usdcMint: explorer(rpc, usdcMint.toBase58()) },
    wallets: {} as Record<string, any>,
    pools: {} as Record<string, any>,
    loans: [] as any[],
    notes: [
      "Yalnızca PUBLIC key'ler vardır; gizli anahtarlar .keys/ içindedir ve paylaşılmaz.",
      "Kredi durumu zincirdeki `status` alanıdır ve yalnızca crank_loan / repay / payoff ile değişir: Active krediler, vadeleri geçse bile biri crank edene kadar 'Active' görünür (demo süresi: dönem 60 sn).",
      "loans[].status seed anındaki gerçek zincir durumudur; targetStatus planlanan durumdur.",
    ],
  };
  for (const role of ROLES) {
    out.wallets[role] = {
      publicKey: kp[role].publicKey.toBase58(),
      usdcAccount: ata[role].toBase58(),
      explorer: explorer(rpc, kp[role].publicKey.toBase58()),
    };
  }
  for (const name of ["house", "vehicle"] as PoolName[]) {
    const P = pools[name];
    const cfg = POOL_CFG[name];
    const st = await program.account.pool.fetch(P.pool);
    out.pools[name] = {
      poolId: P.poolId,
      address: P.pool.toBase58(),
      explorer: explorer(rpc, P.pool.toBase58()),
      vault: P.vault.toBase58(),
      firstLossVault: P.firstLoss.toBase58(),
      reserve: P.reserve.toBase58(),
      shareMint: P.shareMint.toBase58(),
      platformTreasury: ata.platform.toBase58(),
      assetType: name,
      maxLtvBps: cfg.maxLtvBps,
      rateBps: cfg.rateBps,
      termMonths: cfg.termMonths,
      recoveryCoeffBps: cfg.recoveryCoeffBps,
      periodSeconds: PERIOD,
      graceSeconds: GRACE,
      idleCash: big(st.idleCash).toString(),
      totalOutstanding: big(st.totalOutstanding).toString(),
      totalShares: big(st.totalShares).toString(),
      firstLossBalance: big(st.firstLossBalance).toString(),
      reserveBalance: big(st.reserveBalance).toString(),
      lossProvision: big(st.lossProvision).toString(),
      nextLoanId: num(st.nextLoanId),
      loanIds: created.filter((x) => x.pool === name).map((x) => x.id),
    };
  }
  for (const c of created) {
    const L = await loanState(c);
    out.loans.push({
      pool: c.pool,
      loanId: c.id,
      address: L.loan.toBase58(),
      explorer: explorer(rpc, L.loan.toBase58()),
      loanEscrow: L.escrow.toBase58(),
      collateralEscrow: L.collateral.toBase58(),
      borrower: L.data.borrower.toBase58(),
      seller: L.data.seller.toBase58(),
      price: big(L.data.price).toString(),
      principal: big(L.data.principal).toString(),
      installment: big(L.data.installment).toString(),
      remainingPrincipal: big(L.data.remainingPrincipal).toString(),
      status: statusName(L.data.status),
      targetStatus: c.plan.target,
    });
  }
  if (warnings.length) out.warnings = warnings;

  // Güvenlik: çıktıda gizli anahtar bulunmamalı (64 sayılık dizi ya da secret alanı).
  const json = JSON.stringify(out, null, 2) + "\n";
  if (/\[\s*(\d+\s*,\s*){63}\d+\s*\]/.test(json) || /secret/i.test(json.replace(/Yalnızca PUBLIC[^"]*/, ""))) {
    throw new Error("Çıktıda gizli anahtar olabilir; dosya yazılmadı.");
  }
  if (!isLocalRpc(rpc) && (json.includes(rpc) || /api[-_]?key|helius/i.test(json))) {
    throw new Error("Çıktıda RPC adresi/API anahtarı olabilir; dosya yazılmadı.");
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, json);

  const counts: Record<string, number> = {};
  for (const l of out.loans) counts[`${l.pool}:${l.status}`] = (counts[`${l.pool}:${l.status}`] ?? 0) + 1;
  console.log("\nSeed tamam →", path.relative(ROOT, OUT_FILE));
  console.table(counts);
  if (warnings.length) console.warn("UYARILAR:\n  " + warnings.join("\n  "));
  console.log(`(deployments dosyası: ${path.relative(ROOT, DEPLOY_FILE)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
