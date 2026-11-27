// 10 demo cüzdanını oluşturur, SOL ile fonlar, USDC hesaplarını açar ve USDC basar.
// Gizli anahtarlar .keys/<rol>.json'a yazılır (gitignore'da); devnet.json'a yalnızca adresler.
//   npx ts-node -P scripts/tsconfig.json scripts/create-wallets.ts            (dry-run)
//   npx ts-node -P scripts/tsconfig.json scripts/create-wallets.ts --execute
//
// Roller (CLAUDE.md): 2 yatırımcı, 2 alıcı, 1 satıcı, 1 underwriter, 1 tescil ajanı,
// 1 platform (= pool admin, record_recovery ikinci imzacısı), 1 recoveryAgent (ayrı cüzdan,
// pool.recovery_agent), 1 yabancı crank.
import { LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo } from "@solana/spl-token";
import {
  ROLES,
  Role,
  USDC,
  EXECUTE,
  getProvider,
  loadOrCreateKeypair,
  log,
  pk,
  readDeployment,
  writeDeployment,
} from "./lib";

/** Rol başına hedef SOL (devnet'te kıt; platform pool/hesap kirası öder). */
const SOL: Record<Role, number> = {
  platform: 1.0,
  underwriter: 0.2,
  titleAgent: 0.2,
  recoveryAgent: 0.2, // record_recovery imzacısı (pool.recovery_agent)
  crank: 0.2,
  seller: 0.1,
  investorA: 0.2,
  investorB: 0.2,
  borrowerMaria: 0.3, // apply_loan: Loan + iki escrow hesabı kirası
  borrowerDiego: 0.3,
};

/** Rol başına basılacak mock USDC. */
const USDC_MINT_AMOUNT: Record<Role, bigint> = {
  platform: 50_000n * USDC, // ilk zarar kasası + hazine
  investorA: 500_000n * USDC,
  investorB: 500_000n * USDC,
  borrowerMaria: 50_000n * USDC, // peşinat 30.700 + teminat ≈ 1.628
  borrowerDiego: 20_000n * USDC, // araç: 8.120 + 747
  seller: 0n,
  underwriter: 0n,
  titleAgent: 0n,
  recoveryAgent: 100_000n * USDC, // satış gelirinin çıktığı hesap (record_recovery recovery_source)
  crank: 0n,
};

/** RPC düğümü yeni oluşturulan hesabı hemen görmeyebilir (TokenAccountNotFoundError): kısa aralıkla yeniden dene. */
async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

async function main() {
  const provider = getProvider();
  const conn = provider.connection;
  const payer = (provider.wallet as any).payer;
  const d = readDeployment();
  if (!d.usdcMint) throw new Error("Önce create-mock-usdc.ts --execute çalıştır.");
  const mint = pk(d.usdcMint);

  for (const role of ROLES) {
    const { kp, created } = loadOrCreateKeypair(role);
    log(`${role}: ${kp.publicKey.toBase58()} ${created ? "(yeni anahtar)" : "(mevcut anahtar)"}`);

    const targetLamports = Math.round(SOL[role] * LAMPORTS_PER_SOL);
    const have = await conn.getBalance(kp.publicKey);
    const need = Math.max(0, targetLamports - have);
    log(`  SOL: ${have / LAMPORTS_PER_SOL} → hedef ${SOL[role]} (gönderilecek ${need / LAMPORTS_PER_SOL})`);
    log(`  USDC: ${USDC_MINT_AMOUNT[role] / USDC} basılacak`);

    if (!EXECUTE) {
      d.wallets[role] = {
        pubkey: kp.publicKey.toBase58(),
        usdc: getAssociatedTokenAddressSync(mint, kp.publicKey).toBase58(),
      };
      continue;
    }

    if (need > 0) {
      const tx = new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: need })
      );
      await sendAndConfirmTransaction(conn, tx, [payer]);
    }
    const ata = await retry(() => getOrCreateAssociatedTokenAccount(conn, payer, mint, kp.publicKey));
    if (USDC_MINT_AMOUNT[role] > 0n && ata.amount < USDC_MINT_AMOUNT[role]) {
      await mintTo(conn, payer, mint, ata.address, payer, USDC_MINT_AMOUNT[role] - ata.amount);
    }
    d.wallets[role] = { pubkey: kp.publicKey.toBase58(), usdc: ata.address.toBase58() };
  }

  writeDeployment(d);
  if (EXECUTE) console.log("\ndeployments/devnet.json güncellendi. .keys/ klasörünü paylaşma.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
