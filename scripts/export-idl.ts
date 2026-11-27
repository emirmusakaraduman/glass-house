// IDL ve TS tiplerini frontend'e teslim klasörüne kopyalar: deployments/idl/.
// Zincire yazmaz. Program yeniden derlendiğinde (özellikle Kişi 2'nin instruction'ları
// eklendikten sonra) tekrar çalıştırılmalıdır.
//   npx ts-node -P scripts/tsconfig.json scripts/export-idl.ts
import * as fs from "fs";
import * as path from "path";
import { ROOT, DEPLOY_FILE } from "./lib";

const out = path.join(ROOT, "deployments", "idl");
fs.mkdirSync(out, { recursive: true });

const idlSrc = path.join(ROOT, "target", "idl", "glasshouse.json");
const typesSrc = path.join(ROOT, "target", "types", "glasshouse.ts");
const idl = JSON.parse(fs.readFileSync(idlSrc, "utf-8"));
const deployment = JSON.parse(fs.readFileSync(DEPLOY_FILE, "utf-8"));

if (idl.address !== deployment.programId) {
  throw new Error(`IDL adresi (${idl.address}) devnet.json programId (${deployment.programId}) ile uyuşmuyor.`);
}
fs.copyFileSync(idlSrc, path.join(out, "glasshouse.json"));
fs.copyFileSync(typesSrc, path.join(out, "glasshouse.ts"));

const names = (idl.instructions as { name: string }[]).map((i) => i.name);
const accounts = (idl.accounts as { name: string }[] | undefined)?.map((a) => a.name) ?? [];
console.log(`IDL kopyalandı → ${out}`);
console.log(`instruction'lar (${names.length}): ${names.join(", ")}`);
console.log(`hesap tipleri : ${accounts.join(", ")}`);
