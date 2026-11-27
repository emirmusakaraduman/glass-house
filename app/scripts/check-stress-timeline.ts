import { HOUSE_STRESS_BASE, VEHICLE_STRESS_BASE, leveragedBank, lender2008, runStress, type StressScenario } from "../src/lib/stress";
import { TIMELINE_MONTHS, buildTimeline, frameAt, type Timeline } from "../src/lib/stressTimeline";

// The /stress animation must end on runStress() exactly, and no layer may ever hold more than it has.
// Run: npm run check:stress

let failed = 0;
const check = (ok: boolean, label: string) => {
  if (!ok) failed++;
  if (!ok) console.log(`FAIL ${label}`);
  return ok;
};

const scenarios: [string, StressScenario][] = [
  ["house 30% / 20 / 10%", { ...HOUSE_STRESS_BASE, priceDrop: 0.3, defaults: 20, saleCost: 0.1 }],
  ["house 30% / 20 / 15%", { ...HOUSE_STRESS_BASE, priceDrop: 0.3, defaults: 20, saleCost: 0.15 }],
  ["house 40% / 20 / 10%", { ...HOUSE_STRESS_BASE, priceDrop: 0.4, defaults: 20, saleCost: 0.1 }],
  ["house 40% / 30 / 10%", { ...HOUSE_STRESS_BASE, priceDrop: 0.4, defaults: 30, saleCost: 0.1 }],
  ["car 50% / 20 / 10%", { ...VEHICLE_STRESS_BASE, priceDrop: 0.5, defaults: 20, saleCost: 0.1 }],
];

const EPS = 1e-6;

function checkSide(name: string, tl: Timeline, s: StressScenario, withBank: boolean) {
  const r = runStress(s);
  const last = tl.frames[TIMELINE_MONTHS];
  let ok = true;
  // Exact equality: the last frame is the same arithmetic as runStress, not an approximation.
  ok = check(last.realizedLoss === r.totalLoss, `${name}: total loss ${last.realizedLoss} vs ${r.totalLoss}`) && ok;
  ok = check(last.absorbed.firstLoss === r.absorbedByFirstLoss, `${name}: first-loss ${last.absorbed.firstLoss} vs ${r.absorbedByFirstLoss}`) && ok;
  ok = check(last.absorbed.reserve === r.absorbedByReserve, `${name}: reserve ${last.absorbed.reserve} vs ${r.absorbedByReserve}`) && ok;
  ok = check(last.absorbed.investors === r.toInvestors, `${name}: investors ${last.absorbed.investors} vs ${r.toInvestors}`) && ok;
  const collateral = s.defaults * Math.min(r.collateralPerLoan, Math.max(0, r.claimPerLoan - r.netSalePerLoan));
  ok = check(last.absorbed.collateral === collateral, `${name}: collateral ${last.absorbed.collateral} vs ${collateral}`) && ok;
  ok = check(last.sold === s.defaults && last.late === 0 && last.defaulted === 0, `${name}: every defaulted loan sold by month 15`) && ok;
  ok = check(Math.abs(last.priceIndex - (1 - s.priceDrop)) < 1e-12, `${name}: price ends at 1 − drop`) && ok;
  if (withBank) {
    const bank = leveragedBank(s);
    ok = check(last.bankEquityLeft === bank.equityLeft, `${name}: bank equity left ${last.bankEquityLeft} vs ${bank.equityLeft}`) && ok;
  }

  // Every step (0.01 month): within capacity, never decreasing, waterfall order, sums add up.
  let prev = frameAt(tl, 0);
  for (let i = 0; i <= TIMELINE_MONTHS * 100; i++) {
    const f = frameAt(tl, i / 100);
    const a = f.absorbed;
    const at = `${name} @ month ${(i / 100).toFixed(2)}`;
    for (const k of ["collateral", "firstLoss", "reserve", "investors"] as const) {
      if (!check(a[k] <= tl.capacity[k] + EPS, `${at}: ${k} ${a[k]} over capacity ${tl.capacity[k]}`)) return false;
      if (!check(a[k] >= prev.absorbed[k] - EPS, `${at}: ${k} went down`)) return false;
    }
    if (!check(a.reserve <= EPS || a.firstLoss >= tl.capacity.firstLoss - EPS, `${at}: reserve used before first-loss is empty`)) return false;
    if (!check(a.investors <= EPS || a.reserve >= tl.capacity.reserve - EPS, `${at}: investors hit before reserve is empty`)) return false;
    if (!check(Math.abs(a.firstLoss + a.reserve + a.investors - f.realizedLoss) < EPS, `${at}: layers don't add up to the loss`)) return false;
    if (!check(f.priceIndex <= prev.priceIndex + 1e-12, `${at}: price went up`)) return false;
    prev = f;
  }
  // Monthly frames are the same function sampled on whole months.
  for (let m = 0; m <= TIMELINE_MONTHS; m++) {
    ok = check(JSON.stringify(tl.frames[m]) === JSON.stringify(frameAt(tl, m)), `${name}: frame ${m} differs from frameAt(${m})`) && ok;
  }
  return ok;
}

for (const [label, s] of scenarios) {
  const gh = buildTimeline(s);
  const old = lender2008(s);
  const oldTl = buildTimeline(old, { withBank: true });
  const sameHouses = JSON.stringify(gh.plan.map((p) => p.index)) === JSON.stringify(oldTl.plan.map((p) => p.index));
  check(sameHouses, `${label}: both sides default the same houses`);
  const a = checkSide(`${label} GlassHouse`, gh, s, false);
  const b = checkSide(`${label} 2008`, oldTl, old, true);
  const r = runStress(s);
  const r08 = runStress(old);
  console.log(
    `${a && b && sameHouses ? "ok  " : "FAIL"} ${label}: GlassHouse investors ${r.toInvestors.toFixed(2)} (${(r.toInvestorsPct * 100).toFixed(2)}%), 2008 investors ${r08.toInvestors.toFixed(2)} (${(r08.toInvestorsPct * 100).toFixed(2)}%)`,
  );
}

// Raising the default count keeps the earlier houses: the animation can switch scenarios mid-run.
const p20 = buildTimeline({ ...HOUSE_STRESS_BASE, defaults: 20 }).plan.map((p) => p.index);
const p30 = buildTimeline({ ...HOUSE_STRESS_BASE, defaults: 30 }).plan.map((p) => p.index);
console.log(`${check(JSON.stringify(p30.slice(0, 20)) === JSON.stringify(p20), "defaults prefix") ? "ok  " : "FAIL"} 30 defaults include the same first 20 houses`);
const none = buildTimeline({ ...HOUSE_STRESS_BASE, defaults: 0 });
console.log(`${check(none.frames[TIMELINE_MONTHS].realizedLoss === 0 && none.plan.length === 0, "zero defaults") ? "ok  " : "FAIL"} zero defaults: no loss`);

if (failed) {
  console.error(`\n${failed} stress timeline check(s) failed`);
  process.exit(1);
}
console.log("\nall stress timeline checks passed");
