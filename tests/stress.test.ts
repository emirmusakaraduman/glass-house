// Stres testi: 100 kredi, 20 temerrüt, gerçek program (LiteSVM). Motor: tests/lib/stressSim.ts.
// Çıktı şeması scripts/out/stress.json ile aynıdır; bu test şemayı ve kontrol rakamlarını kilitler.
//
// Kontrol rakamları (kılavuz): ev havuzu, 20 temerrüt, masraf %10:
//   düşüş %30 → toplam zarar ≈ 229.937 USD, yatırımcıya 0
//   düşüş %40 → yatırımcıya ≈ 24.937 USD
// Faiz düzeltmesinden önce program kredi başına ≈ 408 USD (bir aylık faiz) yukarıda çıkıyordu:
// Late2'de teminattan ödenen faiz, record_recovery'de birikmiş faize ikinci kez ekleniyordu.
// Düzeltmeden sonra (Loan.reserved[8..16] interest_settled) toplam zarar kılavuzla ±5 USD uyumludur.

import { expect } from "chai";
import { MATRIX, runAll, runScenario, ScenarioDetail, ScenarioRow } from "./lib/stressSim";
import { buildNotes, EXPECTED } from "./lib/stressNotes";

/** Late2'de teminattan kesilen taksidin faizinin yedek fona giren payı (%0,5 / %7 × 408,33 × 20 kredi). */
const RESERVE_INTEREST_SHARE = 583.33;
const DEFAULTS = 20;

describe("stres simülasyonu (100 kredi, 20 temerrüt)", function () {
  this.timeout(600_000);

  let rows: ScenarioRow[];
  let details: ScenarioDetail[];
  const find = (pool: string, cost: number, drop: number) =>
    rows.find((r) => r.pool === pool && r.costPct === cost && r.dropPct === drop)!;

  before(async () => {
    ({ rows, details } = await runAll());
  });

  it("12 senaryo üretir; JSON alanları şemayla birebir", () => {
    expect(rows).to.have.length(12);
    expect(MATRIX).to.have.length(6);
    for (const r of rows) {
      expect(Object.keys(r)).to.deep.equal([
        "pool",
        "costPct",
        "dropPct",
        "defaults",
        "perLoanShortfall",
        "totalLoss",
        "firstLossAndReserveUsed",
        "seniorSharePriceBefore",
        "seniorSharePriceAfter",
        "investorLoss",
        "investorLossPct",
      ]);
      expect(r.defaults).to.equal(DEFAULTS);
      expect(r.seniorSharePriceBefore).to.equal(1);
    }
    expect(buildNotes(rows, details).length).to.be.greaterThan(5);
  });

  it("ev, masraf %10 / düşüş %30: yatırımcıya 0; toplam zarar kılavuzla (229.937) ±5 USD uyumlu", () => {
    const r = find("house", 10, 30);
    expect(r.investorLoss).to.equal(0);
    expect(r.investorLossPct).to.equal(0);
    // Zararı kasa + yedek yer.
    expect(r.firstLossAndReserveUsed).to.be.closeTo(r.totalLoss, 0.01);
    // Faiz düzeltmesi: Late2'de teminattan ödenen faiz birikmiş faizden düşülür (eskiden +8.167 USD sapma).
    expect(r.totalLoss).to.be.closeTo(EXPECTED.totalLoss_10_30, 5);
    expect(r.perLoanShortfall).to.be.closeTo(r.totalLoss / DEFAULTS, 0.01);
  });

  it("ev, masraf %10 / düşüş %40: yatırımcıya ≈ 24.937 USD yansır (yedeğe giren faiz payı kadar eksik)", () => {
    const r = find("house", 10, 40);
    const d = details[rows.indexOf(r)];
    expect(r.investorLoss).to.be.greaterThan(0);
    // Kasa (350.000) + yedek (35.000) tamamen tükenir. Yedek, Late2 kesintilerinden ≈ 583 USD faiz payı da aldı.
    expect(r.firstLossAndReserveUsed).to.be.closeTo(d.firstLossStart + d.reserveStart + RESERVE_INTEREST_SHARE, 1);
    // Kılavuz 24.937; yedeğe giren faiz payı kasa+yedeği büyüttüğü için yatırımcıya ≈ 583 USD daha az düşer.
    expect(r.investorLoss).to.be.closeTo(EXPECTED.investorLoss_10_40 - RESERVE_INTEREST_SHARE, 5);
  });

  it("zarar masraf ve düşüşle monoton artar (ev ve 2008)", () => {
    for (const pool of ["house", "2008"]) {
      for (const drop of [30, 40]) {
        const a = find(pool, 10, drop).totalLoss;
        const b = find(pool, 15, drop).totalLoss;
        const c = find(pool, 20, drop).totalLoss;
        expect(a < b && b < c).to.equal(true);
      }
      for (const cost of [10, 15, 20]) {
        expect(find(pool, cost, 30).totalLoss < find(pool, cost, 40).totalLoss).to.equal(true);
      }
    }
    // Her %5 masraf = satış fiyatının %5'i × 20 kredi (satış fiyatı 70.000 → 3.500 USD / kredi).
    const step = find("house", 15, 30).totalLoss - find("house", 10, 30).totalLoss;
    expect(step).to.be.closeTo(DEFAULTS * 3_500, 1);
  });

  it("2008 modu: kasa ve yedek yok, zarar senior'a yansır ve pay fiyatı zincirde düşer", () => {
    for (const m of MATRIX) {
      const r08 = find("2008", m.costPct, m.dropPct);
      const rh = find("house", m.costPct, m.dropPct);
      expect(r08.seniorSharePriceAfter).to.be.lessThan(1);
      expect(r08.investorLoss).to.be.greaterThan(r08.totalLoss * 0.99); // yalnızca Late2 faiz payı kadar yedek
      expect(r08.investorLossPct).to.be.greaterThan(rh.investorLossPct);
      expect(r08.seniorSharePriceAfter).to.be.lessThan(rh.seniorSharePriceAfter);
    }
    // NAV, karşılık kasa/yedeği aşınca zaten crank anında düşer (kriz satıştan önce görünür).
    const i = rows.indexOf(find("2008", 10, 30));
    expect(details[i].sharePriceAfterCrank).to.be.lessThan(1);
  });

  it("ev havuzunda %30 düşüşte pay fiyatı düşmez (faiz alacağı kasa/yedekle karşılanır); %40'ta yatırımcı zararı vardır", () => {
    expect(find("house", 10, 30).seniorSharePriceAfter).to.be.greaterThan(1);
    expect(find("house", 20, 40).investorLoss).to.be.greaterThan(find("house", 10, 40).investorLoss);
  });

  it("tek senaryo bağımsız çalışır ve belirleyicidir (aynı girdi → aynı sonuç)", async () => {
    const again = await runScenario({ pool: "house", costPct: 10, dropPct: 30 });
    expect(again.row).to.deep.equal(find("house", 10, 30));
  });
});
