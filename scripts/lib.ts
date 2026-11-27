// Ortak yardımcılar: deploy scriptleri (create-mock-usdc, create-wallets, create-pools).
//
// Güvenlik: tüm scriptler varsayılan olarak DRY-RUN çalışır (zincire yazmaz, ne yapacağını
// yazdırır). Zincire yazmak için `--execute` gerekir.
// Cluster ve deployer cüzdanı ortamdan gelir:
//   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com  ANCHOR_WALLET=<deployer.json>
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import idl from "../target/idl/glasshouse.json";
import type { Glasshouse } from "../target/types/glasshouse";

export const ROOT = path.resolve(__dirname, "..");
export const DEPLOY_FILE =
  process.env.DEPLOYMENT_FILE ?? path.join(ROOT, "deployments", "devnet.json");
/** Gizli anahtarlar burada; .gitignore'dadır, ASLA paylaşılmaz/commit'lenmez. */
export const KEYS_DIR = path.join(ROOT, ".keys");

export const USDC = 1_000_000n;

export const ROLES = [
  "investorA",
  "investorB",
  "borrowerMaria",
  "borrowerDiego",
  "seller",
  "underwriter",
  "titleAgent",
  "platform",
  "recoveryAgent",
  "crank",
] as const;
export type Role = (typeof ROLES)[number];

export const args = new Set(process.argv.slice(2));
export const EXECUTE = args.has("--execute");

export const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

export const log = (msg: string) => console.log(EXECUTE ? msg : `[dry-run] ${msg}`);

/** RPC adresini yazdırırken sorgu parametrelerini ve yolu (API anahtarı) at: yalnızca ana makine adı. */
export function safeEndpoint(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(geçersiz adres)";
  }
}

export function getProvider(): anchor.AnchorProvider {
  const provider = anchor.AnchorProvider.env(); // ANCHOR_PROVIDER_URL + ANCHOR_WALLET
  anchor.setProvider(provider);
  console.log(`cluster : ${safeEndpoint(provider.connection.rpcEndpoint)}`);
  console.log(`deployer: ${provider.wallet.publicKey.toBase58()}`);
  console.log(`mod     : ${EXECUTE ? "EXECUTE (zincire yazar)" : "dry-run (zincire yazmaz)"}`);
  return provider;
}

export function getProgram(provider: anchor.AnchorProvider): Program<Glasshouse> {
  return new Program(idl as Glasshouse, provider);
}

// ---------------------------------------------------------------- anahtarlar

export function loadOrCreateKeypair(role: string): { kp: Keypair; created: boolean } {
  const file = path.join(KEYS_DIR, `${role}.json`);
  if (fs.existsSync(file)) {
    const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf-8")));
    return { kp: Keypair.fromSecretKey(secret), created: false };
  }
  const kp = Keypair.generate();
  if (EXECUTE) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  return { kp, created: true };
}

export function requireKeypair(role: string): Keypair {
  const file = path.join(KEYS_DIR, `${role}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} yok. Önce scripts/create-wallets.ts --execute çalıştır.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf-8"))));
}

// ---------------------------------------------------------------- deployments/devnet.json

export interface Deployment {
  cluster: string;
  programId: string;
  usdcMint: string | null;
  /** Yalnızca genel adresler; gizli anahtarlar .keys/ içinde. */
  wallets: Partial<Record<Role, { pubkey: string; usdc: string }>>;
  pools: Record<string, Record<string, unknown>>;
  updatedAt: string | null;
}

export function readDeployment(): Deployment {
  return JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf-8"));
}

export function writeDeployment(d: Deployment) {
  if (!EXECUTE) return;
  d.updatedAt = new Date().toISOString();
  const json = JSON.stringify(d, null, 2) + "\n";
  // Güvenlik: RPC API anahtarı gibi bir gizli bilgi repoya giden dosyaya asla yazılmaz.
  if (/api[-_]?key|helius|https?:\/\//i.test(json)) {
    throw new Error("devnet.json içine RPC adresi/API anahtarı yazılmak üzere; işlem durduruldu.");
  }
  fs.writeFileSync(DEPLOY_FILE, json);
}

export const pk = (s: string) => new PublicKey(s);
