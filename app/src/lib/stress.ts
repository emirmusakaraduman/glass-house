import { monthlyPayment } from "./finance";

// Stress model from the v4 doc ("Stres testi: dürüst rakamlar").
// This is the same arithmetic as the doc's tables so the panel can show sliders.
// The video should show the Bankrun simulation output from the real program; when the
// test teammate exports it, load that JSON and label this model as "calculation".

export interface StressScenario {
  /** Number of loans in the pool. */
  loans: number;
  loanSize: number;
  price: number;
  annualRate: number;
  termMonths: number;
  /** Defaulted loans. */
  defaults: number;
  /** Asset price drop at sale, 0.30 = 30%. */
  priceDrop: number;
  /** Sale and enforcement cost, 0.10 = 10%. */
  saleCost: number;
  /** Months of unpaid interest: 3 missed installments + 12 months to sell = 15. */
  monthsAccrued: number;
  collateralInstallments: number;
  firstLossVault: number;
  reserve: number;
}

export interface StressResult {
  claimPerLoan: number;
  netSalePerLoan: number;
  collateralPerLoan: number;
  gapPerLoan: number;
  totalLoss: number;
  absorbedByFirstLoss: number;
  absorbedByReserve: number;
  toInvestors: number;
  /** Investor loss over senior principal (pool − first-loss vault). */
  toInvestorsPct: number;
  /** Price drop at which investors start to lose, for this cost and default count. */
  breakEvenDrop: number;
}

export function runStress(s: StressScenario): StressResult {
  const installment = monthlyPayment(s.loanSize, s.annualRate, s.termMonths);
  const collateral = s.collateralInstallments * installment;
  // Default happens early, so principal has barely amortized: interest accrues on the full loan.
  const claim = s.loanSize + s.loanSize * (s.annualRate / 12) * s.monthsAccrued;
  const netSale = s.price * (1 - s.priceDrop) * (1 - s.saleCost);
  const gap = Math.max(0, claim - netSale - collateral);
  const totalLoss = s.defaults * gap;
  const absorbedByFirstLoss = Math.min(totalLoss, s.firstLossVault);
  const absorbedByReserve = Math.min(totalLoss - absorbedByFirstLoss, s.reserve);
  const toInvestors = Math.max(0, totalLoss - absorbedByFirstLoss - absorbedByReserve);
  const senior = s.loans * s.loanSize - s.firstLossVault;

  // Break-even: defaults × (claim − netSale − collateral) = firstLoss + reserve
  const cushion = s.firstLossVault + s.reserve;
  const neededNetSale = s.defaults > 0 ? claim - collateral - cushion / s.defaults : 0;
  const breakEvenDrop = s.defaults > 0 ? 1 - neededNetSale / (s.price * (1 - s.saleCost)) : 1;

  return {
    claimPerLoan: claim,
    netSalePerLoan: netSale,
    collateralPerLoan: collateral,
    gapPerLoan: gap,
    totalLoss,
    absorbedByFirstLoss,
    absorbedByReserve,
    toInvestors,
    toInvestorsPct: senior > 0 ? toInvestors / senior : 0,
    breakEvenDrop: Math.max(0, Math.min(1, breakEvenDrop)),
  };
}

export const HOUSE_STRESS_BASE: StressScenario = {
  loans: 100,
  loanSize: 70_000,
  price: 100_000,
  annualRate: 0.07,
  termMonths: 240,
  defaults: 20,
  priceDrop: 0.3,
  saleCost: 0.1,
  monthsAccrued: 15,
  collateralInstallments: 3,
  firstLossVault: 350_000,
  reserve: 35_000,
};

export const VEHICLE_STRESS_BASE: StressScenario = {
  loans: 100,
  loanSize: 12_000,
  price: 20_000,
  annualRate: 0.09,
  termMonths: 60,
  defaults: 20,
  priceDrop: 0.3,
  saleCost: 0.1,
  monthsAccrued: 15,
  collateralInstallments: 3,
  firstLossVault: 60_000,
  reserve: 6_000,
};

/** "2008 mode": same program, create_pool(max_ltv = 97%, first_loss = 0, reserve = 0), no collateral deposit. */
export function lender2008(base: StressScenario): StressScenario {
  return {
    ...base,
    loanSize: base.price * 0.97,
    collateralInstallments: 0,
    firstLossVault: 0,
    reserve: 0,
  };
}

/**
 * A 30× leveraged bank holding the same loans: equity = book / 30.
 * The program cannot model leverage, so the UI labels this as a calculation.
 */
export function leveragedBank(s: StressScenario, leverage = 30) {
  const book = s.loans * s.loanSize;
  const equity = book / leverage;
  const loss = runStress(s).totalLoss;
  return { book, equity, loss, wipedOut: loss >= equity, equityLeft: Math.max(0, equity - loss) };
}
