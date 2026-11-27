import { amortizationSchedule, round2, monthlyPayment } from "../finance";
import { POOLS } from "../pools";
import type { Loan, LoanStatus, PoolId, PoolState, SharePricePoint } from "../types";
import { loanKey } from "./client";

// Demo data for the mock client: 10 home loans and 3 car loans, like the seed script
// (one late home loan; a late car loan would trip the 10% brake in a 3-loan pool)
// the test teammate will run on devnet. Everything here is clearly fake (mock signatures, demo wallets).

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fakeAddress(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 44; i++) s += B58[Math.floor(rand() * B58.length)];
  return s;
}

export function fakeHash(rand: () => number): string {
  let s = "";
  for (let i = 0; i < 64; i++) s += "0123456789abcdef"[Math.floor(rand() * 16)];
  return s;
}

/** Wallet used for writes in mock mode when no wallet is connected. */
export const DEMO_WALLET = "DemoWa11etGLASSHouse1111111111111111111111111";

/** Test USDC every wallet starts with in mock mode (the demo wallet and any newly connected one). */
export const MOCK_STARTING_BALANCE = 250_000;

interface SeedLoan {
  poolId: PoolId;
  seq: number;
  price: number;
  downRatio: number;
  region: string;
  status: LoanStatus;
  paid: number;
  autopay: boolean;
}

const SEED: SeedLoan[] = [
  { poolId: "house", seq: 1, price: 145_000, downRatio: 0.3, region: "Panama City", status: "Active", paid: 22, autopay: true },
  { poolId: "house", seq: 2, price: 98_000, downRatio: 0.32, region: "Guayaquil", status: "Active", paid: 18, autopay: true },
  { poolId: "house", seq: 3, price: 210_000, downRatio: 0.35, region: "Panama City", status: "Active", paid: 15, autopay: true },
  { poolId: "house", seq: 4, price: 120_000, downRatio: 0.3, region: "San Salvador", status: "Active", paid: 12, autopay: true },
  { poolId: "house", seq: 5, price: 86_000, downRatio: 0.4, region: "David", status: "PaidOff", paid: 9, autopay: false },
  { poolId: "house", seq: 6, price: 82_000, downRatio: 0.3, region: "Panama City", status: "Late1", paid: 10, autopay: false },
  { poolId: "house", seq: 7, price: 132_000, downRatio: 0.33, region: "Quito", status: "Active", paid: 8, autopay: true },
  { poolId: "house", seq: 8, price: 99_500, downRatio: 0.3, region: "Panama City", status: "Active", paid: 6, autopay: true },
  { poolId: "house", seq: 9, price: 160_000, downRatio: 0.38, region: "Guayaquil", status: "Active", paid: 4, autopay: true },
  { poolId: "house", seq: 10, price: 115_000, downRatio: 0.3, region: "Panama City", status: "Pending", paid: 0, autopay: false },
  { poolId: "vehicle", seq: 1, price: 22_000, downRatio: 0.4, region: "Panama City", status: "Active", paid: 14, autopay: true },
  { poolId: "vehicle", seq: 2, price: 18_500, downRatio: 0.45, region: "Guayaquil", status: "Active", paid: 7, autopay: true },
  { poolId: "vehicle", seq: 3, price: 26_000, downRatio: 0.4, region: "San Salvador", status: "Active", paid: 5, autopay: true },
];

export interface MockState {
  pools: Record<PoolId, PoolState>;
  loans: Map<string, Loan>;
  history: Record<PoolId, SharePricePoint[]>;
  positions: Record<PoolId, Map<string, { shares: number; locked: number }>>;
  /** Simulated USDC per wallet. Wallets not in the map start at MOCK_STARTING_BALANCE. */
  balances: Map<string, number>;
}

export function buildMockState(now = Date.now()): MockState {
  const rand = rng(42);
  const loans = new Map<string, Loan>();

  for (const s of SEED) {
    const p = POOLS[s.poolId];
    const period = p.periodSeconds * 1000;
    const grace = p.graceSeconds * 1000;
    const downPayment = round2(s.price * s.downRatio);
    const principal = round2(s.price - downPayment);
    const installment = round2(monthlyPayment(principal, p.annualRate, p.termMonths));
    const schedule = amortizationSchedule(principal, p.annualRate, p.termMonths);
    const remaining = s.status === "Pending" || s.status === "PaidOff" ? (s.status === "Pending" ? principal : 0) : (schedule[s.paid - 1]?.balance ?? principal);
    const createdAt = now - (s.paid + 1) * 30 * 24 * 3600 * 1000;

    let status = s.status;
    let nextDueAt: number | null = null;
    let missed = 0;
    let provision = 0;
    let collateral = p.collateralInstallments * installment;
    let lateFeeDue = 0;
    let remainingPrincipal = remaining;

    if (status === "Active") {
      nextDueAt = now + Math.floor(rand() * period);
    } else if (status === "Late1") {
      nextDueAt = now - grace - 20_000;
      missed = 1;
      lateFeeDue = round2(installment * p.lateFee);
      provision = round2(remaining * p.provisionRates[1]);
    } else if (status === "Late2") {
      nextDueAt = now - grace - period - 15_000;
      missed = 2;
      lateFeeDue = round2(installment * p.lateFee);
      // second missed installment was taken from collateral
      collateral = round2(collateral - installment);
      const interest = round2(remaining * (p.annualRate / 12));
      remainingPrincipal = round2(remaining - (installment - interest));
      provision = round2(remainingPrincipal * p.provisionRates[2]);
    }

    const events: Loan["events"] = [
      { at: createdAt, kind: "applied", amount: downPayment },
    ];
    if (status !== "Pending") {
      events.push({ at: createdAt + 3_600_000, kind: "approved", amount: s.price });
      events.push({ at: createdAt + 7_200_000, kind: "funded", amount: principal });
      events.push({ at: createdAt + 86_400_000, kind: "title_confirmed" });
      // One event per paid installment, monthly from the month after creation (the last one a month ago).
      for (let k = 1; k <= s.paid; k++) {
        events.push({ at: createdAt + k * 30 * 24 * 3600 * 1000, kind: "repaid", amount: installment, note: `Installment ${k} of ${p.termMonths}` });
      }
    }
    if (status === "Late1") events.push({ at: now - 20_000, kind: "late1", note: "Grace period passed" });
    if (status === "Late2") {
      events.push({ at: now - period - 15_000, kind: "late1", note: "Grace period passed" });
      events.push({ at: now - 15_000, kind: "late2", amount: installment, note: "Installment taken from collateral" });
    }
    if (status === "PaidOff") events.push({ at: now - 5 * 24 * 3600 * 1000, kind: "paid_off", note: "Early payoff, no penalty" });

    loans.set(loanKey(s.poolId, s.seq), {
      key: loanKey(s.poolId, s.seq),
      poolId: s.poolId,
      seq: s.seq,
      status,
      price: s.price,
      // Appraisal at or slightly above price, so seeded loans respect max LTV on min(price, appraisal).
      appraisal: status === "Pending" ? null : round2(s.price * (1 + rand() * 0.04)),
      downPayment,
      principal,
      remainingPrincipal: status === "PaidOff" ? 0 : remainingPrincipal,
      annualRate: p.annualRate,
      termMonths: p.termMonths,
      installment,
      paidInstallments: s.paid,
      missedInstallments: missed,
      nextDueAt,
      lateFeeDue,
      collateral: status === "PaidOff" ? 0 : collateral,
      originationFee: round2(principal * p.originationFee),
      provision,
      accruedInterest: 0,
      region: s.region,
      borrower: fakeAddress(rand),
      seller: fakeAddress(rand),
      docHash: status === "Pending" ? null : fakeHash(rand),
      assetRefHash: fakeHash(rand),
      createdAt,
      autopay: s.autopay,
      events,
    });
  }

  const pools = {} as Record<PoolId, PoolState>;
  const history = {} as Record<PoolId, SharePricePoint[]>;
  const positions = {} as MockState["positions"];
  const targets: Record<PoolId, { idle: number; price: number }> = {
    house: { idle: 410_000, price: 1.0418 },
    vehicle: { idle: 28_000, price: 1.0611 },
  };

  for (const id of ["house", "vehicle"] as PoolId[]) {
    const p = POOLS[id];
    const live = [...loans.values()].filter((l) => l.poolId === id && ["Active", "Late1", "Late2", "Defaulted", "Funded"].includes(l.status));
    const outstanding = round2(live.reduce((s, l) => s + l.remainingPrincipal, 0));
    const provision = round2(live.reduce((s, l) => s + l.provision, 0));
    const firstLossVault = Math.ceil((outstanding * 0.06) / 1000) * 1000;
    // Seeded above the 1% brake line. See notes: half the origination fee alone only reaches 0.5%.
    const reserve = Math.ceil((outstanding * 0.012) / 100) * 100;
    const idleCash = targets[id].idle;
    const impairment = Math.max(0, provision - firstLossVault - reserve);
    const nav = idleCash + outstanding - impairment;
    const totalShares = round2(nav / targets[id].price);
    const seqs = [...loans.values()].filter((l) => l.poolId === id).map((l) => l.seq);

    pools[id] = {
      params: p,
      idleCash,
      outstandingPrincipal: outstanding,
      lossProvision: provision,
      firstLossVault,
      reserve,
      platformFees: 0,
      totalShares,
      escrowed: 0,
      nextLoanSeq: Math.max(...seqs) + 1,
      withdrawQueue: [],
    };

    // 24 monthly points of accumulating share price (interest stays in the pool).
    const g = p.poolRate / 12;
    const points: SharePricePoint[] = [];
    const jitter = rng(id === "house" ? 7 : 11);
    for (let i = 0; i < 24; i++) {
      const back = 23 - i;
      const base = targets[id].price / Math.pow(1 + g * 0.92, back);
      points.push({ at: now - back * 30 * 24 * 3600 * 1000, price: base * (1 - jitter() * 0.0006) });
    }
    points[points.length - 1] = { at: now, price: targets[id].price };
    history[id] = points;

    positions[id] = new Map([[DEMO_WALLET, { shares: id === "house" ? 25_000 : 4_000, locked: 0 }]]);
  }

  return { pools, loans, history, positions, balances: new Map([[DEMO_WALLET, MOCK_STARTING_BALANCE]]) };
}
