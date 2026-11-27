// scripts/out/stress.json `notes[]` metinleri. Rakamlar sonuçlardan hesaplanır; sabit metin yalnızca
// yöntem ve tanımları anlatır. Frontend bu dizeleri olduğu gibi gösterebilir.

import type { ScenarioDetail, ScenarioRow } from "./stressSim";

/** Beklenen kontrol rakamları (kılavuz): ev havuzu, 20 temerrüt. */
export const EXPECTED = {
  /** Masraf %10, düşüş %30 → toplam zarar (USD). */
  totalLoss_10_30: 229_937,
  /** Masraf %10, düşüş %40 → yatırımcıya yansıyan (USD). */
  investorLoss_10_40: 24_937,
} as const;

const fmt = (v: number): string => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (v: number, d = 1): string => `%${v.toFixed(d).replace(".", ",")}`;

export function buildNotes(rows: ScenarioRow[], details: ScenarioDetail[]): string[] {
  const idx = (pool: string, cost: number, drop: number) =>
    rows.findIndex((r) => r.pool === pool && r.costPct === cost && r.dropPct === drop);
  const h = idx("house", 10, 30);
  const h40 = idx("house", 10, 40);
  const c08 = idx("2008", 10, 30);
  const rh = rows[h];
  const rh40 = rows[h40];
  const r08 = rows[c08];
  const dh = details[h];
  const d08 = details[c08];

  const extraLoss = rh.totalLoss - EXPECTED.totalLoss_10_30;
  const perLoanExtra = extraLoss / rh.defaults;
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
    `Kontrol rakamları: ev havuzu, masraf %10, düşüş %30 → beklenen toplam zarar ≈ ${fmt(EXPECTED.totalLoss_10_30)} USD ve yatırımcıya 0; ölçülen ${fmt(rh.totalLoss)} USD, yatırımcıya ${fmt(rh.investorLoss)}. %40 düşüşte beklenen yatırımcı zararı ≈ ${fmt(EXPECTED.investorLoss_10_40)} USD; ölçülen ${fmt(rh40.investorLoss)} USD.`,
    `Sapmanın nedeni (+${fmt(extraLoss)} USD toplam zarar, kredi başına ≈ ${fmt(perLoanExtra)} USD ≈ bir aylık faiz): programda Late2 adımında bir taksit teminattan kesilir ve gecikme bedeli, ilk ayın faizi ve anaparaya uygulanır; ama record_recovery birikmiş faizi vadeden itibaren TÜM dönemler (15 ay) için hesaplar. Teminattan ödenen ilk ayın faizi bir kez ödenmiş ve bir kez de alacağa eklenmiş olur. Kılavuz hesabı 14 ay faiz + 3 taksitlik tam teminat varsayar; program 15 ay faiz + kesilmiş teminat (2 taksit) kullanır. Fark kredi başına ≈ 408 USD'dir.`,
    `%40 düşüşteki yatırımcı zararı farkı (+${fmt(extraInvestor)} USD): yukarıdaki faiz farkı (+${fmt(extraLoss)}) eksi Late2 kesintilerinden yedek fona giren faiz payı (≈ ${fmt(rh40.firstLossAndReserveUsed - 385_000)} USD; yedek 35.000'den büyüdü, bu yüzden firstLossAndReserveUsed 385.000'i aşar).`,
    `2008 modu: ilk zarar kasası ve yedek fon 0 olduğundan zararın neredeyse tamamı senior'a gider; masraf %10, düşüş %30'da yatırımcı zararı ${fmt(r08.investorLoss)} USD (${pct(r08.investorLossPct)}), pay fiyatı ${r08.seniorSharePriceBefore.toFixed(3)} → ${r08.seniorSharePriceAfter.toFixed(3)}. Karşılık (provision) yedek ve kasayı aştığı için NAV zaten crank anında düşer (satıştan önce pay fiyatı ${d08.sharePriceAfterCrank.toFixed(3)}).`,
    `hesaplama (programda YOK): 30x kaldıraçlı bir bankanın özkaynağı varlıklarının 1/${leverage} = ${pct(equityPct, 2)}'idir; bu orandan büyük bir portföy zararı özkaynağı sıfırlar. Bu simülasyonda portföy zararı: ev havuzu ${pct(lossRateHouse, 2)} (${fmt(rh.totalLoss)} / ${fmt(dh.portfolioPrincipal)}), 2008 modu ${pct(lossRate08, 2)} (${fmt(r08.totalLoss)} / ${fmt(d08.portfolioPrincipal)}) — masraf %10, düşüş %30. Yani 30x kaldıraçlı banka ev havuzu senaryosunda özkaynağının tamamına yakınını, 2008 modunda ise ${(lossRate08 / equityPct).toFixed(1).replace(".", ",")} katını kaybeder. GlassHouse'ta kaldıraç yoktur: yatırımcı sermayesi kredilerin tamamını finanse eder ve zarar önce ilk zarar kasası ve yedek fonla karşılanır.`,
    "Satış geliri değerin %50'sinin (min_recovery_bps) altında kalan kurtarmalar ikinci imza (admin) gerektirir; simülasyon bunları admin ortak imzasıyla işler (masraf %20 ve düşüş %40 için satış 48.000 < 50.000 USD).",
  ];
}
