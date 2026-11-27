// Havuzları kurar (create_pool). Ürün değerleri burada SABİTTİR (karar 2: program yalnızca
// güvenlik aralığını doğrular, ürün değerini bu script belirler).
//   npx ts-node -P scripts/tsconfig.json scripts/create-pools.ts [--first-loss <USDC>]          (dry-run)
//   npx ts-node -P scripts/tsconfig.json scripts/create-pools.ts [--first-loss <USDC>] --execute
//
// Pool admin = platform cüzdanı (imzalar, kirayı öder). recovery_agent = AYRI recoveryAgent cüzdanı;
// min_recovery_bps = 5000: satış geliri appraised_value × %50 altındaysa record_recovery
// ikinci imza (co_signer == pool.admin = platform) ister. Bu iki değer create_pool sonrası DEĞİŞMEZ.
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  EXECUTE,
  USDC,
  flag,
  getProgram,
  getProvider,
  log,
  pk,
  readDeployment,
  requireKeypair,
  writeDeployment,
} from "./lib";

/** Demo parametreleri: period 60 sn, grace 10 sn (CLAUDE.md). */
const DEMO = { periodSeconds: 60, graceSeconds: 10 };

const POOLS = {
  house: {
    poolId: 1,
    assetType: { house: {} },
    maxLtvBps: 7000,
    rateBps: 700,
    termMonths: 240,
    recoveryCoeffBps: 6300,
    provisionBps: [0, 500, 1500, 1500], // [Active, Late1, Late2, Defaulted taban]
    bufferBps: 1000,
    brakeLateBps: 1000,
    brakeReserveBps: 25, // karar 1
    minFirstLossBps: 500,
    entryExitFeeBps: 20,
    minRecoveryBps: 5000,
    titleTimeoutSeconds: 3600,
    skipFirstLoss: false,
  },
  vehicle: {
    poolId: 2,
    assetType: { vehicle: {} },
    maxLtvBps: 6000,
    rateBps: 900,
    termMonths: 60,
    recoveryCoeffBps: 5400,
    // Varsayım: kılavuz araç için ayrı karşılık/ücret/fren değeri vermiyor; ev ile aynı.
    provisionBps: [0, 500, 1500, 1500], // [Active, Late1, Late2, Defaulted taban]
    bufferBps: 1000,
    brakeLateBps: 1000,
    brakeReserveBps: 25,
    minFirstLossBps: 500,
    entryExitFeeBps: 20,
    minRecoveryBps: 5000,
    titleTimeoutSeconds: 3600,
    skipFirstLoss: false,
  },
  // P14: 2008 modu. Kişi 2'nin stres simülasyonu bu havuzu kullanır (adresi devnet.json'da
  // pools.crisis2008). Ev ile aynı faiz/vade/katsayı; yalnızca güvenlik tamponları kapalı:
  //   max_ltv %97, min_first_loss 0 (ilk zarar kasası şartı yok),
  //   brake_reserve 0 ("reserve 0": yedek fon boş olsa da yedek fon freni kredi durdurmaz).
  // Bu havuza ilk zarar kasası YATIRILMAZ (skipFirstLoss): mod tanımı gereği 0 kalır.
  crisis2008: {
    poolId: 3,
    assetType: { house: {} },
    maxLtvBps: 9700,
    rateBps: 700,
    termMonths: 240,
    recoveryCoeffBps: 6300,
    provisionBps: [0, 500, 1500, 1500], // [Active, Late1, Late2, Defaulted taban]
    bufferBps: 1000,
    brakeLateBps: 1000,
    brakeReserveBps: 0,
    minFirstLossBps: 0,
    entryExitFeeBps: 20,
    minRecoveryBps: 5000,
    titleTimeoutSeconds: 3600,
    skipFirstLoss: true,
  },
} as const;

async function main() {
  const provider = getProvider();
  const program = getProgram(provider);
  const d = readDeployment();
  if (!d.usdcMint) throw new Error("usdcMint yok: önce create-mock-usdc.ts.");
  for (const r of ["platform", "underwriter", "titleAgent", "recoveryAgent"] as const) {
    if (!d.wallets[r]) throw new Error(`${r} cüzdanı yok: önce create-wallets.ts.`);
  }
  const usdcMint = pk(d.usdcMint);
  const platform = requireKeypair("platform");
  const treasury = pk(d.wallets.platform!.usdc);
  const firstLoss = BigInt(Math.round(Number(flag("--first-loss") ?? "0") * 1e6));

  for (const [name, cfg] of Object.entries(POOLS)) {
    const poolIdBn = new BN(cfg.poolId);
    const [pool] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), platform.publicKey.toBuffer(), poolIdBn.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const seed = (s: string) =>
      PublicKey.findProgramAddressSync([Buffer.from(s), pool.toBuffer()], program.programId)[0];
    const accounts = {
      admin: platform.publicKey,
      pool,
      usdcMint,
      platformTreasury: treasury,
      vault: seed("vault"),
      firstLossVault: seed("first_loss"),
      reserveVault: seed("reserve"),
      shareMint: seed("shares"),
    };

    const exists = (await provider.connection.getAccountInfo(pool)) !== null;
    log(`${name}: pool ${pool.toBase58()} ${exists ? "(zaten var, atlanıyor)" : "(oluşturulacak)"}`);
    log(
      `  LTV %${cfg.maxLtvBps / 100} faiz %${cfg.rateBps / 100} vade ${cfg.termMonths} ay ` +
        `katsayı ${cfg.recoveryCoeffBps} period ${DEMO.periodSeconds}s grace ${DEMO.graceSeconds}s`
    );

    if (EXECUTE && !exists) {
      await program.methods
        .createPool({
          poolId: poolIdBn,
          assetType: cfg.assetType,
          underwriter: pk(d.wallets.underwriter!.pubkey),
          titleAgent: pk(d.wallets.titleAgent!.pubkey),
          recoveryAgent: pk(d.wallets.recoveryAgent!.pubkey),
          maxLtvBps: cfg.maxLtvBps,
          rateBps: cfg.rateBps,
          termMonths: cfg.termMonths,
          recoveryCoeffBps: cfg.recoveryCoeffBps,
          graceSeconds: new BN(DEMO.graceSeconds),
          periodSeconds: new BN(DEMO.periodSeconds),
          provisionBps: [...cfg.provisionBps],
          bufferBps: cfg.bufferBps,
          brakeLateBps: cfg.brakeLateBps,
          brakeReserveBps: cfg.brakeReserveBps,
          minFirstLossBps: cfg.minFirstLossBps,
          entryExitFeeBps: cfg.entryExitFeeBps,
          minRecoveryBps: cfg.minRecoveryBps,
          titleTimeoutSeconds: new BN(cfg.titleTimeoutSeconds),
        })
        .accountsPartial({
          ...accounts,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([platform])
        .rpc();
    }

    if (firstLoss > 0n && cfg.skipFirstLoss) {
      log(`  ${name}: 2008 modu, ilk zarar kasası yatırılmaz (min_first_loss 0)`);
    } else if (firstLoss > 0n) {
      log(`  ilk zarar kasasına ${firstLoss / USDC} USDC yatırılacak`);
      if (EXECUTE) {
        await program.methods
          .fundFirstLoss(new BN(firstLoss.toString()))
          .accountsPartial({
            admin: platform.publicKey,
            pool,
            adminTokenAccount: treasury,
            firstLossVault: accounts.firstLossVault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([platform])
          .rpc();
      }
    }

    d.pools[name] = {
      poolId: cfg.poolId,
      admin: platform.publicKey.toBase58(),
      pool: pool.toBase58(),
      vault: accounts.vault.toBase58(),
      firstLossVault: accounts.firstLossVault.toBase58(),
      reserveVault: accounts.reserveVault.toBase58(),
      shareMint: accounts.shareMint.toBase58(),
      platformTreasury: treasury.toBase58(),
      assetType: name,
      minFirstLossBps: cfg.minFirstLossBps,
      brakeReserveBps: cfg.brakeReserveBps,
      maxLtvBps: cfg.maxLtvBps,
      rateBps: cfg.rateBps,
      termMonths: cfg.termMonths,
      recoveryCoeffBps: cfg.recoveryCoeffBps,
      periodSeconds: DEMO.periodSeconds,
      graceSeconds: DEMO.graceSeconds,
    };
  }
  writeDeployment(d);
  if (EXECUTE) console.log("\ndeployments/devnet.json güncellendi.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
