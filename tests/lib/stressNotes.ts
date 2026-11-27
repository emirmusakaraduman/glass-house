// scripts/out/stress.json `notes[]` metinleri. Rakamlar sonuçlardan hesaplanır; sabit metin yalnızca
// yöntem ve tanımları anlatır. Frontend bu dizeleri olduğu gibi gösterebilir.

import type { BreakEven, ScenarioDetail, ScenarioRow } from "./stressSim";

/** Beklenen kontrol rakamları (kılavuz): ev havuzu, 20 temerrüt. */
export const EXPECTED = {
  /** Masraf %10, düşüş %30 → toplam zarar (USD). */
  totalLoss_10_30: 229_937,
  /** Masraf %10, düşüş %40 → yatırımcıya yansıyan (USD). */
  investorLoss_10_40: 24_937,
} as const;

const fmt = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (v: number, d = 1): string => `%${v.toFixed(d).replace(".", ",")}`;

export function buildNotes(rows: ScenarioRow[], details: ScenarioDetail[], breakEven: BreakEven[] = []): string[] {
  const idx = (pool: string, cost: number, drop: number, defaults = 20) =>
    rows.findIndex((r) => r.pool === pool && r.costPct === cost && r.dropPct === drop && r.defaults === defaults);
  const h = idx("house", 10, 30);
  const h40 = idx("house", 10, 40);
  const c08 = idx("2008", 10, 30);
  const rh = rows[h];
  const rh40 = rows[h40];
  const r08 = rows[c08];
  const dh = details[h];
  const d08 = details[c08];

  const extraLoss = rh.totalLoss - EXPECTED.totalLoss_10_30;
  const extraInvestor = rh40.investorLoss - EXPECTED.investorLoss_10_40;
  const lossRateHouse = (rh.totalLoss / dh.portfolioPrincipal) * 100;
  const lossRate08 = (r08.totalLoss / d08.portfolioPrincipal) * 100;
  const leverage = 30;
  const equityPct = 100 / leverage;

  return [
    "Yöntem: gerçek program (crank_loan + record_recovery) LiteSVM'de çalıştırıldı; 100 kredi Active hesap olarak yazıldı, ilk 20'si üç taksit + grace sonra 'yabancı' cüzdanın crank'iyle Defaulted oldu, ~15 ay faiz birikmiş sayıldı (3 + 12 dönem) ve satışlar record_recovery ile işlendi. Kalan 80 kredi zamanında ödeniyor kabul edildi (crank edilmedi).",
    "Satış geliri = değerleme × (1 − düşüş) × (1 − masraf). Masraf satış fiyatı üzerinden alınır. Tüm tutarlar USD; pay fiyatları birimsiz (1,0 = başlangıç).",
    "Ev havuzu: LTV %70, faiz %7 sabit, 240 ay, ilk zarar kasası 350.000, yedek fon 35.000, likidite tamponu ≈ %10; 100 kredi × 70.000 (ev 100.000) = 7.000.000 USD. 2008 modu: aynı program, create_pool(max_ltv = %97, first_loss = 0, reserve = 0); 100 kredi × 97.000 = 9.700.000 USD.",
    "Alan tanımları: perLoanShortfall = toplam zarar / temerrüt sayısı. totalLoss = Σ (kalan anapara + birikmiş faiz + gecikme bedeli − teminat − satış geliri), negatifse 0. firstLossAndReserveUsed = zararın ilk zarar kasası + yedek fonun yediği kısmı. investorLoss = bunların da yetmediği, senior'a yansıyan kısım. investorLossPct = investorLoss / kriz öncesi senior NAV × 100.",
    "seniorSharePriceBefore/After zincirdeki NAV'dan ölçülür: pay fiyatı = senior NAV / toplam pay (nav.rs ile aynı sanal ofset). Kriz öncesi 1,0'a ayarlanır. DİKKAT: temerrüt alacağına birikmiş faiz de dahildir; ilk zarar kasası ve yedek fon bu faizi de karşıladığında NAV faiz kadar ARTAR. Bu yüzden ev havuzunda yatırımcı zararı 0 iken fiyat 1,0'ın üstüne çıkabilir, yatırımcı zararı varken bile fiyat düşmeyebilir (investorLoss ile birlikte okuyun).",
    `Kontrol rakamları: ev havuzu, masraf %10, düşüş %30 → beklenen toplam zarar ≈ ${fmt(EXPECTED.totalLoss_10_30)} USD ve yatırımcıya 0; ölçülen ${fmt(rh.totalLoss)} USD, yatırımcıya ${fmt(rh.investorLoss)} (fark ${Math.abs(extraLoss).toFixed(1)} USD, yuvarlama). %40 düşüşte beklenen yatırımcı zararı ≈ ${fmt(EXPECTED.investorLoss_10_40)} USD; ölçülen ${fmt(rh40.investorLoss)} USD.`,
    `%40 düşüşte ölçülen yatırımcı zararı kılavuzdan ≈ ${fmt(-extraInvestor)} USD azdır: Late2 adımında teminattan kesilen taksidin faizinin yedek payı (faiz × %0,5 / %7) yedek fona girer; kasa + yedek 385.000 yerine ≈ ${fmt(rh40.firstLossAndReserveUsed)} USD olur.`,
    "Faiz muhasebesi: Late2'de teminattan kesilen taksidin faizi Loan'da (reserved[8..16], interest_settled) tutulur ve temerrütte birikmiş faizden düşülür; aynı ayın faizi hem ödenmiş hem alacağa eklenmiş sayılmaz. Gecikmeden çıkışta (repay) ve kapanışta sıfırlanır. Bu düzeltmeden önce program kredi başına ≈ 408 USD (bir aylık faiz) fazla zarar gösteriyordu.",
    `2008 modu: ilk zarar kasası ve yedek fon 0 olduğundan zararın neredeyse tamamı senior'a gider; masraf %10, düşüş %30'da yatırımcı zararı ${fmt(r08.investorLoss)} USD (${pct(r08.investorLossPct)}), pay fiyatı ${r08.seniorSharePriceBefore.toFixed(3)} → ${r08.seniorSharePriceAfter.toFixed(3)}. Karşılık (provision) yedek ve kasayı aştığı için NAV zaten crank anında düşer (satıştan önce pay fiyatı ${d08.sharePriceAfterCrank.toFixed(3)}).`,
    `2008 modu kılavuz karşılaştırması: kılavuz (%30 düşüş, masraf %10) kredi başına ≈ 42.488, toplam ≈ 849.750 USD zarar verir; ölçülen ${fmt(r08.totalLoss)} USD. Fark ≈ ${fmt(849_750 - r08.totalLoss)} USD = 20 kredi × borçlunun ≈ 3 taksitlik teminatı: kılavuz bu hesapta teminatı saymaz, program 2008 modunda da teminatı (apply_loan'da zorunlu) zarardan düşer.`,
    `hesaplama (programda YOK): 30x kaldıraçlı bir bankanın özkaynağı varlıklarının 1/${leverage} = ${pct(equityPct, 2)}'idir; bu orandan büyük bir portföy zararı özkaynağı sıfırlar. Bu simülasyonda portföy zararı: ev havuzu ${pct(lossRateHouse, 2)} (${fmt(rh.totalLoss)} / ${fmt(dh.portfolioPrincipal)}), 2008 modu ${pct(lossRate08, 2)} (${fmt(r08.totalLoss)} / ${fmt(d08.portfolioPrincipal)}) — masraf %10, düşüş %30. Yani 30x kaldıraçlı banka ev havuzu senaryosunda özkaynağının tamamına yakınını, 2008 modunda ise ${(lossRate08 / equityPct).toFixed(1).replace(".", ",")} katını kaybeder. GlassHouse'ta kaldıraç yoktur: yatırımcı sermayesi kredilerin tamamını finanse eder ve zarar önce ilk zarar kasası ve yedek fonla karşılanır.`,
    "Satış geliri değerin %50'sinin (min_recovery_bps) altında kalan kurtarmalar ikinci imza (admin) gerektirir; simülasyon bunları admin ortak imzasıyla işler (masraf %20 ve düşüş %40 için satış 48.000 < 50.000 USD).",
    ...vehicleNotes(rows, breakEven),
  ];
}

const bePct = (v: number): string => `%${v.toFixed(1).replace(".", ",")}`;

/** Araç havuzu, 30 temerrüt ve kırılma noktası notları. */
function vehicleNotes(rows: ScenarioRow[], breakEven: BreakEven[]): string[] {
  const out: string[] = [];
  const v = rows.filter((r) => r.pool === "vehicle" && r.defaults === 20);
  if (v.length) {
    const r = v.find((x) => x.costPct === 10 && x.dropPct === 50);
    out.push(
      "Araç havuzu (pool = \"vehicle\") bir TAHMİNDİR: 100 kredi × 12.000 USD (araç 20.000), ilk zarar kasası 60.000, yedek 6.000, katsayı 0,54. Hasar, çalınma, taşınabilirlik ve ikinci el iskontosu modellenmedi; kırılma noktası iddia edilmez. Kılavuzun araç tablosundan küçük farklar vardır (masraf %10: düşüş %40'ta toplam zarar ≈ 35.807 / kılavuz 36.054, düşüş %50'de yatırımcıya ≈ 5.707 / kılavuz 6.054): kılavuz alacağı tam anaparanın 15 aylık faiziyle hesaplar, program Late2'de teminattan ödenen anaparayı ve faizi düşer." +
        (r ? ` Masraf %10, düşüş %50'de toplam zarar ${Math.round(r.totalLoss).toLocaleString("en-US")} USD, yatırımcıya ${Math.round(r.investorLoss).toLocaleString("en-US")} USD.` : ""),
    );
  }
  const d30 = rows.filter((r) => r.defaults === 30);
  if (d30.length) {
    out.push(
      "30 temerrüt senaryoları (defaults = 30): ev için düşüş %40, araç için %50 ve masraf %10/%15/%20. Aynı pool, costPct ve dropPct ile iki satır olabilir; defaults alanına göre ayırın.",
    );
  }
  if (breakEven.length) {
    const fmtBe = (pool: string) =>
      breakEven
        .filter((b) => b.pool === pool)
        .map((b) => `masraf %${b.costPct}: ${bePct(b.dropPct)}`)
        .join(", ");
    out.push(
      `Kırılma noktası (yatırımcının zarar görmeye başladığı fiyat düşüşü, 20 temerrüt, zincirde ikiye bölmeyle ölçüldü): ev ${fmtBe("house")}; araç (tahmin) ${fmtBe("vehicle")}. Kılavuz: ev ≈ %38,6 / %35,0 / %30,9, araç ≈ %48 / %45 / %42; fark Late2 kesintilerinden yedek fona giren faiz payından gelir.`,
    );
  }
  return out;
}
