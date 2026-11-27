// Checks the frontend math against the numbers in the v4 design doc.
// Run: npm run check:finance
import { HOUSE_POOL, VEHICLE_POOL } from "../src/lib/pools";
import { closingCash, closingCashWithBuffer, maxAffordablePrice, paymentFactor, totalCost } from "../src/lib/finance";
import { HOUSE_STRESS_BASE, VEHICLE_STRESS_BASE, leveragedBank, lender2008, runStress } from "../src/lib/stress";

let failed = 0;
function near(label: string, actual: number, expected: number, tol: number) {
  const ok = Math.abs(actual - expected) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${actual.toFixed(4)} (doc: ${expected}, ±${tol})`);
}

// Example loans
const maria = totalCost(100_000, 30_000, HOUSE_POOL);
near("house installment", maria.installment, 542.71, 0.005);
near("house first month interest", maria.firstMonthInterest, 408.33, 0.005);
near("house first month principal", maria.firstMonthPrincipal, 134.38, 0.005);
near("house total interest", maria.totalInterest, 60_250, 1);
near("house fee", maria.fee, 700, 0.01);
near("house collateral", maria.collateral, 1_628, 1);
near("house cash at closing", maria.cashAtClosing, 32_328, 1);
near("house nominal cost %", maria.nominalAnnualCost * 100, 7.13, 0.005);
near("house effective cost %", maria.effectiveAnnualCost * 100, 7.37, 0.005);

const diego = totalCost(20_000, 8_000, VEHICLE_POOL);
near("car installment", diego.installment, 249.1, 0.005);
near("car first month interest", diego.firstMonthInterest, 90, 0.005);
near("car first month principal", diego.firstMonthPrincipal, 159.1, 0.005);
near("car total interest", diego.totalInterest, 2_946, 1);
near("car fee", diego.fee, 120, 0.01);
near("car collateral", diego.collateral, 747, 1);
near("car cash at closing", diego.cashAtClosing, 8_867, 1);

// İlan Bulucu
near("f house", paymentFactor(HOUSE_POOL), 0.007753, 0.0000005);
near("f car", paymentFactor(VEHICLE_POOL), 0.020758, 0.0000005);
const mMax = maxAffordablePrice({ monthlyIncome: 1_800, existingMonthlyDebt: 0, savings: 32_500 }, HOUSE_POOL);
near("house cash ratio", mMax.cashRatio, 0.3233, 0.00005);
near("Maria income limit", mMax.byIncome, 116_000, 200);
near("Maria cash limit", mMax.byCash, 100_500, 100);
const dMax = maxAffordablePrice({ monthlyIncome: 900, existingMonthlyDebt: 0, savings: 9_000 }, VEHICLE_POOL);
near("car cash ratio", dMax.cashRatio, 0.4434, 0.00005);
near("Diego income limit", dMax.byIncome, 25_300, 50);
near("Diego cash limit", dMax.byCash, 20_300, 50);

// Appraisal below price: 100k price, 90k appraisal -> loan 63k, down 37k
const low = closingCash(100_000, HOUSE_POOL, { appraisal: 90_000 });
near("low appraisal loan", low.loan, 63_000, 0.01);
near("low appraisal down payment", low.downPayment, 37_000, 0.01);
near("buffer helper matches", closingCashWithBuffer(100_000, HOUSE_POOL).downPayment, 37_000, 0.01);

// Stress: house
const h30 = runStress(HOUSE_STRESS_BASE);
near("house claim/loan", h30.claimPerLoan, 76_125, 1);
near("house gap/loan @30%", h30.gapPerLoan, 11_497, 1);
near("house total loss @30%", h30.totalLoss, 229_937, 2);
near("house to investors @30%", h30.toInvestors, 0, 0);
const h40 = runStress({ ...HOUSE_STRESS_BASE, priceDrop: 0.4 });
near("house total loss @40%", h40.totalLoss, 409_937, 2);
near("house to investors @40%", h40.toInvestors, 24_937, 2);
near("house to investors % @40%", h40.toInvestorsPct * 100, 0.37, 0.01);
const h40x30 = runStress({ ...HOUSE_STRESS_BASE, priceDrop: 0.4, defaults: 30 });
near("house total loss @40%, 30 defaults", h40x30.totalLoss, 614_906, 3);
near("house to investors @40%, 30 defaults", h40x30.toInvestors, 229_906, 3);
near("house break-even @10% cost", h30.breakEvenDrop * 100, 38.6, 0.05);
near("house break-even @15% cost", runStress({ ...HOUSE_STRESS_BASE, saleCost: 0.15 }).breakEvenDrop * 100, 35.0, 0.05);
near("house break-even @20% cost", runStress({ ...HOUSE_STRESS_BASE, saleCost: 0.2 }).breakEvenDrop * 100, 30.9, 0.05);
near("house to investors @40%, 15% cost", runStress({ ...HOUSE_STRESS_BASE, priceDrop: 0.4, saleCost: 0.15 }).toInvestors, 84_937, 2);
near("house to investors @40%, 20% cost", runStress({ ...HOUSE_STRESS_BASE, priceDrop: 0.4, saleCost: 0.2 }).toInvestors, 144_937, 2);

// 2008 mode
const old = lender2008(HOUSE_STRESS_BASE);
const o30 = runStress(old);
near("2008 gap/loan @30%", o30.gapPerLoan, 42_488, 1);
near("2008 total loss @30%", o30.totalLoss, 849_750, 2);
near("2008 bank equity (30x)", leveragedBank(old).equity, 323_333, 1);

// Stress: vehicle (estimate)
const v30 = runStress(VEHICLE_STRESS_BASE);
near("car claim/loan", v30.claimPerLoan, 13_350, 1);
near("car gap/loan @30%", v30.gapPerLoan, 3, 1);
const v50 = runStress({ ...VEHICLE_STRESS_BASE, priceDrop: 0.5 });
near("car total loss @50%", v50.totalLoss, 72_054, 3);
near("car to investors @50%", v50.toInvestors, 6_054, 3);
near("car break-even @10% cost", v30.breakEvenDrop * 100, 48, 0.6);
near("car break-even @15% cost", runStress({ ...VEHICLE_STRESS_BASE, saleCost: 0.15 }).breakEvenDrop * 100, 45, 0.6);
near("car break-even @20% cost", runStress({ ...VEHICLE_STRESS_BASE, saleCost: 0.2 }).breakEvenDrop * 100, 42, 0.6);
console.log(
  `note: car @50% investor share = ${(v50.toInvestorsPct * 100).toFixed(2)}% of senior principal (doc says 0.50%, which divides by the whole 1.2M pool)`,
);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
