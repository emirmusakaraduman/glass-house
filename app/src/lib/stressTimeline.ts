import { leveragedBank, runStress, type StressResult, type StressScenario } from "./stress";

// A month-by-month replay of runStress() for the /stress animation. Pure functions, no UI.
//
// Story: prices slide for 6 months then flatten; the defaulting borrowers miss payments in months
// 1–3; the homes are sold one by one in months 4–15. Each sale realizes that loan's shortfall:
// the borrower's own collateral first, then the gap walks down first-loss vault → reserve →
// investors. Every sale books the scenario's price drop (as runStress does), so the last frame
// equals runStress() exactly; the price curve is the market's path to that level.

export const TIMELINE_MONTHS = 15;
/** Months over which one sale's loss flows into the tanks (the particles' trip). */
export const SALE_FLOW_MONTHS = 0.8;
const FLOW = SALE_FLOW_MONTHS;
/** Same seed on both sides: the same houses default in GlassHouse and in the 2008-style pool. */
const SEED = 20081129;

export type LoanState = "ok" | "late1" | "late2" | "defaulted" | "sold";

export interface LoanPlan {
  /** Position in the 10×10 grid, 0–99. */
  index: number;
  late1At: number;
  late2At: number;
  defaultAt: number;
  soldAt: number;
}

export interface Absorbed {
  collateral: number;
  firstLoss: number;
  reserve: number;
  investors: number;
}

export interface Frame {
  /** Months since the crash started, 0–15 (fractional between monthly frames). */
  month: number;
  /** Asset price as a share of the pre-crash price: 1 at month 0, 1 − priceDrop at month 15. */
  priceIndex: number;
  late: number;
  defaulted: number;
  sold: number;
  /** Cumulative gap past the borrowers' collateral: what the pool's layers have to absorb. */
  realizedLoss: number;
  absorbed: Absorbed;
  /** 30× leveraged bank holding the same loans (2008 side only). */
  bankEquityLeft: number | null;
}

export interface Timeline {
  scenario: StressScenario;
  result: StressResult;
  plan: LoanPlan[];
  capacity: Absorbed;
  /** Collateral each defaulted borrower loses: min(collateral, claim − net sale). */
  collateralUsedPerLoan: number;
  bankEquity: number | null;
  /** Monthly frames, index = month (0–15). */
  frames: Frame[];
}

/** Deterministic shuffle of 0..n−1 (mulberry32). Defaults take a prefix, so more defaults keep the earlier ones. */
function shuffledIndices(n: number, seed = SEED): number[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

/** Price path: 90% of the drop by month 6 (ease-out), the last 10% by month 15. */
export function priceIndexAt(priceDrop: number, t: number): number {
  if (t >= TIMELINE_MONTHS) return 1 - priceDrop;
  const f = t <= 6 ? 0.9 * easeOutCubic(clamp01(t / 6)) : 0.9 + 0.1 * easeOutCubic(clamp01((t - 6) / 9));
  return 1 - priceDrop * f;
}

/** When each defaulting loan misses payments, defaults and is sold. */
export function planLoans(loans: number, defaults: number): LoanPlan[] {
  const n = Math.max(0, Math.min(defaults, loans));
  const order = shuffledIndices(loans);
  return order.slice(0, n).map((index, k) => {
    const late1At = 1 + (1.4 * (k + 0.5)) / n; // 1.0–2.4
    return {
      index,
      late1At,
      late2At: late1At + 0.3,
      defaultAt: late1At + 0.6, // ≤ 3.0
      soldAt: 4 + (11 * (k + 1)) / n, // the last sale lands on month 15
    };
  });
}

export function loanStateAt(p: LoanPlan, t: number): LoanState {
  if (t >= p.soldAt) return "sold";
  if (t >= p.defaultAt) return "defaulted";
  if (t >= p.late2At) return "late2";
  if (t >= p.late1At) return "late1";
  return "ok";
}

/** Share of one sale's loss that has reached the tanks at time t (0 before the trip, 1 once sold). */
export function saleFlow(p: LoanPlan, t: number): number {
  if (t >= p.soldAt) return 1;
  return clamp01((t - (p.soldAt - FLOW)) / FLOW);
}

/** Splits a cumulative gap over the layers in waterfall order. */
function waterfall(gap: number, firstLoss: number, reserve: number) {
  const fl = Math.min(gap, firstLoss);
  const rs = Math.min(gap - fl, reserve);
  return { firstLoss: fl, reserve: rs, investors: Math.max(0, gap - fl - rs) };
}

export function frameAt(tl: Omit<Timeline, "frames">, tIn: number): Frame {
  const t = Math.max(0, Math.min(TIMELINE_MONTHS, tIn));
  const s = tl.scenario;
  let late = 0;
  let defaulted = 0;
  let sold = 0;
  let flows = 0;
  for (const p of tl.plan) {
    const st = loanStateAt(p, t);
    if (st === "late1" || st === "late2") late++;
    else if (st === "defaulted") defaulted++;
    else if (st === "sold") sold++;
    flows += saleFlow(p, t);
  }
  // `flows` is a whole number once every sale has landed, so gap × flows = gap × defaults exactly.
  const gap = tl.result.gapPerLoan * flows;
  const w = waterfall(gap, s.firstLossVault, s.reserve);
  return {
    month: t,
    priceIndex: priceIndexAt(s.priceDrop, t),
    late,
    defaulted,
    sold,
    realizedLoss: gap,
    absorbed: { collateral: tl.collateralUsedPerLoan * flows, ...w },
    bankEquityLeft: tl.bankEquity === null ? null : Math.max(0, tl.bankEquity - gap),
  };
}

/**
 * Builds the timeline for one side. Pass `withBank` for the 2008-style lender (adds the 30× bank).
 * Use the same `loans`/`defaults` on both sides: the defaulting houses are then the same ones.
 */
export function buildTimeline(s: StressScenario, opts: { withBank?: boolean } = {}): Timeline {
  const result = runStress(s);
  const plan = planLoans(s.loans, s.defaults);
  const collateralUsedPerLoan = Math.min(result.collateralPerLoan, Math.max(0, result.claimPerLoan - result.netSalePerLoan));
  const senior = s.loans * s.loanSize - s.firstLossVault;
  const base = {
    scenario: s,
    result,
    plan,
    capacity: { collateral: plan.length * result.collateralPerLoan, firstLoss: s.firstLossVault, reserve: s.reserve, investors: senior },
    collateralUsedPerLoan,
    bankEquity: opts.withBank ? leveragedBank(s).equity : null,
  };
  const frames = Array.from({ length: TIMELINE_MONTHS + 1 }, (_, m) => frameAt(base, m));
  return { ...base, frames };
}
