import type { PoolParams } from "./types";

// Loan math used across the UI. The program computes the same installment on-chain
// with 1e18 fixed-point u128; the TS tests compare both within ±1 micro-USDC.

export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Standard annuity: M = P · r · (1 + r)^n / ((1 + r)^n − 1). */
export function monthlyPayment(principal: number, annualRate: number, months: number): number {
  if (principal <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  const g = Math.pow(1 + r, months);
  return (principal * r * g) / (g - 1);
}

/** f = installment / loan for a pool (0.007753 house, 0.020758 vehicle). */
export function paymentFactor(p: Pick<PoolParams, "annualRate" | "termMonths">): number {
  return monthlyPayment(1, p.annualRate, p.termMonths);
}

export interface ScheduleRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/**
 * Amortization table. Interest is "remaining × r" rounded to cents, and the last
 * installment is "remaining + interest" so the loan closes at exactly zero (same rule as repay).
 */
export function amortizationSchedule(principal: number, annualRate: number, months: number): ScheduleRow[] {
  const r = annualRate / 12;
  const payment = round2(monthlyPayment(principal, annualRate, months));
  const rows: ScheduleRow[] = [];
  let balance = round2(principal);
  for (let m = 1; m <= months && balance > 0; m++) {
    const interest = round2(balance * r);
    const isLast = m === months || payment - interest >= balance;
    const pay = isLast ? round2(balance + interest) : payment;
    const princ = round2(pay - interest);
    balance = round2(balance - princ);
    rows.push({ month: m, payment: pay, interest, principal: princ, balance: Math.max(0, balance) });
  }
  return rows;
}

/** Yearly roll-up of a schedule, for compact tables. */
export function yearlySummary(rows: ScheduleRow[]) {
  const years: { year: number; paid: number; interest: number; principal: number; endBalance: number }[] = [];
  for (const row of rows) {
    const y = Math.ceil(row.month / 12);
    let entry = years[y - 1];
    if (!entry) {
      entry = { year: y, paid: 0, interest: 0, principal: 0, endBalance: 0 };
      years[y - 1] = entry;
    }
    entry.paid += row.payment;
    entry.interest += row.interest;
    entry.principal += row.principal;
    entry.endBalance = row.balance;
  }
  return years.map((y) => ({ ...y, paid: round2(y.paid), interest: round2(y.interest), principal: round2(y.principal) }));
}

/**
 * Monthly internal rate of return for a loan where the borrower receives `netProceeds`
 * (loan minus upfront fee) and pays `payment` for `months` months. Bisection, robust enough for UI.
 */
export function monthlyIrr(netProceeds: number, payment: number, months: number): number {
  const pv = (i: number) => (i === 0 ? payment * months : (payment * (1 - Math.pow(1 + i, -months))) / i);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > netProceeds) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// İlan Bulucu: max price from income and savings. Runs only in the browser;
// income and savings are never sent to the server or to Firecrawl.
// ---------------------------------------------------------------------------

export interface BudgetInput {
  monthlyIncome: number;
  existingMonthlyDebt: number;
  savings: number;
}

export interface MaxPriceResult {
  freeIncome: number;
  /** installment / loan */
  f: number;
  /** cash needed at closing / price, at max LTV */
  cashRatio: number;
  byIncome: number;
  byCash: number;
  maxPrice: number;
  binding: "income" | "cash";
}

export function maxAffordablePrice(b: BudgetInput, p: PoolParams): MaxPriceResult {
  const f = paymentFactor(p);
  const ltv = p.maxLtv;
  const freeIncome = Math.max(0, b.monthlyIncome - b.existingMonthlyDebt);
  // fiyat_gelir = 0,35 · serbest_gelir / (LTV · f)
  const byIncome = (p.maxDti * freeIncome) / (ltv * f);
  // fiyat_nakit = birikim / (peşinat + 0,01·LTV + 3·LTV·f)
  const cashRatio = 1 - ltv + p.originationFee * ltv + p.collateralInstallments * ltv * f;
  const byCash = Math.max(0, b.savings) / cashRatio;
  const maxPrice = Math.min(byIncome, byCash);
  return { freeIncome, f, cashRatio, byIncome, byCash, maxPrice, binding: byCash <= byIncome ? "cash" : "income" };
}

export interface ClosingCash {
  price: number;
  /** Value the loan is sized on: min(price, appraisal). */
  value: number;
  loan: number;
  downPayment: number;
  fee: number;
  collateral: number;
  installment: number;
  total: number;
}

/**
 * Cash the buyer needs at closing. The loan is capped at maxLtv × min(price, appraisal),
 * so a low appraisal pushes the difference onto the down payment.
 */
export function closingCash(price: number, p: PoolParams, opts: { appraisal?: number; downPayment?: number } = {}): ClosingCash {
  const value = Math.min(price, opts.appraisal ?? price);
  const maxLoan = p.maxLtv * value;
  const minDown = price - maxLoan;
  const downPayment = Math.max(minDown, opts.downPayment ?? minDown);
  const loan = Math.max(0, price - downPayment);
  const installment = monthlyPayment(loan, p.annualRate, p.termMonths);
  const fee = p.originationFee * loan;
  const collateral = p.collateralInstallments * round2(installment);
  return { price, value, loan, downPayment, fee, collateral, installment, total: downPayment + fee + collateral };
}

/** Closing cash if the appraisal comes in `buffer` below the listing price (shown as "estimated, with 10% buffer"). */
export function closingCashWithBuffer(price: number, p: PoolParams, buffer = 0.1): ClosingCash {
  return closingCash(price, p, { appraisal: price * (1 - buffer) });
}

export interface TotalCost {
  loan: number;
  downPayment: number;
  installment: number;
  firstMonthInterest: number;
  firstMonthPrincipal: number;
  totalPaid: number;
  totalInterest: number;
  fee: number;
  collateral: number;
  cashAtClosing: number;
  /** Fee-inclusive nominal annual cost (12 × monthly IRR). */
  nominalAnnualCost: number;
  /** Fee-inclusive effective annual cost ((1 + monthly IRR)^12 − 1). Not a legal APR. */
  effectiveAnnualCost: number;
  ltv: number;
}

/** Everything the "total cost" card shows. Nothing is hidden: fee, collateral and interest are all here. */
export function totalCost(price: number, downPayment: number, p: PoolParams): TotalCost {
  const loan = Math.max(0, price - downPayment);
  const installment = round2(monthlyPayment(loan, p.annualRate, p.termMonths));
  const rows = amortizationSchedule(loan, p.annualRate, p.termMonths);
  const totalPaid = round2(rows.reduce((s, r) => s + r.payment, 0));
  const fee = round2(p.originationFee * loan);
  const collateral = round2(p.collateralInstallments * installment);
  const i = loan > 0 ? monthlyIrr(loan - fee, installment, p.termMonths) : 0;
  return {
    loan,
    downPayment,
    installment,
    firstMonthInterest: rows[0]?.interest ?? 0,
    firstMonthPrincipal: rows[0]?.principal ?? 0,
    totalPaid,
    totalInterest: round2(totalPaid - loan),
    fee,
    collateral,
    cashAtClosing: round2(downPayment + fee + collateral),
    nominalAnnualCost: i * 12,
    effectiveAnnualCost: Math.pow(1 + i, 12) - 1,
    ltv: price > 0 ? loan / price : 0,
  };
}

/** Installment / free income, checked by the underwriter against maxDti (35%). */
export function debtToIncome(installment: number, b: Pick<BudgetInput, "monthlyIncome" | "existingMonthlyDebt">): number {
  const free = b.monthlyIncome - b.existingMonthlyDebt;
  return free > 0 ? installment / free : Infinity;
}

/** On-chain value band: house 50k, vehicle 5k. "100k–150k" style label. */
export function valueBand(value: number, width: number): { lo: number; hi: number } {
  const lo = Math.floor(value / width) * width;
  return { lo, hi: lo + width };
}
