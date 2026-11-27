// Stres simülasyonu — SAHİBİ: Kişi 2.
// 100 kredi, 20 temerrüt; ev havuzu ve "2008 modu" havuzu; satış masrafı %10/%15/%20 × fiyat düşüşü %30/%40.
// Gerçek programı (crank_loan, record_recovery) LiteSVM'de çalıştırır; çıktı scripts/out/stress.json
// (Kişi 3'ün paneli okur). Şema SABİT: { generatedAt, scenarios[], notes[] }.
//
// ÇALIŞTIRMA: LiteSVM'in Windows sürümü yok, bu yüzden WSL'de:
//   wsl -d Ubuntu -- bash /mnt/c/Users/testm/Desktop/GlassHouse/scripts/wsl-stress.sh
// (npm run sim:stress Linux/macOS'ta doğrudan çalışır.)

import * as fs from "fs";
import * as path from "path";
import { runAll } from "../tests/lib/stressSim";
import { buildNotes } from "../tests/lib/stressNotes";

async function main() {
  const t0 = Date.now();
  const { rows, details } = await runAll();
  const out = {
    generatedAt: new Date().toISOString(),
    scenarios: rows,
    notes: buildNotes(rows, details),
  };
  const dir = path.resolve(__dirname, "out");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "stress.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");

  console.table(
    rows.map((r) => ({
      pool: r.pool,
      masraf: `%${r.costPct}`,
      düşüş: `%${r.dropPct}`,
      toplamZarar: r.totalLoss,
      kasaVeYedek: r.firstLossAndReserveUsed,
      yatırımcıZararı: r.investorLoss,
      "yatırımcı%": r.investorLossPct,
      fiyatÖnce: r.seniorSharePriceBefore,
      fiyatSonra: r.seniorSharePriceAfter,
    })),
  );
  console.log(`\n${rows.length} senaryo, ${((Date.now() - t0) / 1000).toFixed(1)} sn → ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
