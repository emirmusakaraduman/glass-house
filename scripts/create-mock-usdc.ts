// Mock USDC mint'i (6 decimal) oluşturur ve deployments/devnet.json'a yazar.
// Mint authority = deployer cüzdanı (demo cüzdanlarına USDC basmak için).
//   npx ts-node -P scripts/tsconfig.json scripts/create-mock-usdc.ts            (dry-run)
//   npx ts-node -P scripts/tsconfig.json scripts/create-mock-usdc.ts --execute
import { createMint } from "@solana/spl-token";
import { getProvider, readDeployment, writeDeployment, log, EXECUTE, args } from "./lib";

async function main() {
  const provider = getProvider();
  const d = readDeployment();
  const payer = (provider.wallet as any).payer;

  if (d.usdcMint && !args.has("--force")) {
    console.log(`usdcMint zaten kayıtlı: ${d.usdcMint} (yeniden oluşturmak için --force)`);
    return;
  }
  log("6 decimal mock USDC mint'i oluşturulacak (mint authority = deployer)");
  if (!EXECUTE) return;

  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6);
  d.cluster = provider.connection.rpcEndpoint;
  d.usdcMint = mint.toBase58();
  writeDeployment(d);
  console.log(`usdcMint: ${d.usdcMint}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
