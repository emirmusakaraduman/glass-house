import type {
  InvestorPosition,
  Loan,
  LoanStatus,
  PoolId,
  PoolMetrics,
  PoolState,
  SharePricePoint,
  TxResult,
} from "../types";

// The one interface every screen talks to. Today it is backed by an in-memory mock;
// when the program IDL lands, src/lib/chain/anchor.ts implements the same interface
// and NEXT_PUBLIC_DATA_SOURCE=chain switches over. Screens should not change.

export interface ApplyLoanArgs {
  poolId: PoolId;
  price: number;
  downPayment: number;
  seller: string;
  region: string;
  /** Salted hash of listing URL + content, computed in the browser. Only the hash goes on-chain. */
  assetRefHash: string | null;
}

export interface GlassHouseClient {
  readonly mode: "mock" | "chain";
  /** Wallet used for writes (connected wallet, or a demo wallet in mock mode). */
  readonly actor: string;
  /** A seller wallet this browser can co-sign apply_loan with (chain mode demos). */
  readonly demoSeller?: string;

  getPools(): Promise<PoolState[]>;
  getPool(id: PoolId): Promise<PoolState | null>;
  getLoans(filter?: { poolId?: PoolId; borrower?: string }): Promise<Loan[]>;
  getLoan(key: string): Promise<Loan | null>;
  getSharePriceHistory(poolId: PoolId): Promise<SharePricePoint[]>;
  getPosition(poolId: PoolId, owner: string): Promise<InvestorPosition>;
  /**
   * USDC the wallet holds right now. Mock: simulated test USDC (every new wallet starts with
   * MOCK_STARTING_BALANCE). Chain: the owner's associated USDC token account balance.
   */
  getWalletBalance(owner: string): Promise<number>;

  deposit(poolId: PoolId, amount: number): Promise<TxResult>;
  requestWithdraw(poolId: PoolId, shares: number): Promise<TxResult>;
  processWithdrawals(poolId: PoolId): Promise<TxResult>;

  applyLoan(args: ApplyLoanArgs): Promise<TxResult & { loanKey: string }>;
  approveLoan(loanKey: string, appraisal: number, docHash: string): Promise<TxResult>;
  rejectLoan(loanKey: string): Promise<TxResult>;
  fundLoan(loanKey: string): Promise<TxResult>;
  confirmTitle(loanKey: string): Promise<TxResult>;
  repay(loanKey: string): Promise<TxResult>;
  /** Permissionless: anyone can call it. Idempotent for the same period. */
  crankLoan(loanKey: string): Promise<TxResult & { changed: boolean; message: string }>;
  recordRecovery(loanKey: string, proceeds: number): Promise<TxResult>;

  // Seller on another device (chain mode only). The borrower signs first and gets a link;
  // the seller opens it, checks the terms, signs and sends. The link doesn't expire (durable
  // nonce) until it is used or the borrower cancels it.
  prepareApplyLoan?(args: ApplyLoanArgs): Promise<{ payload: string; loanKey: string }>;
  cancelCosignLinks?(): Promise<TxResult>;
  describeCosign?(payload: string): Promise<CosignRequest>;
  cosignApplyLoan?(payload: string): Promise<TxResult & { loanKey: string }>;

  /** Called after any state change so hooks can refetch. */
  subscribe(listener: () => void): () => void;
}

/** What a co-sign link asks the seller to sign, decoded and checked in the seller's browser. */
export interface CosignRequest {
  poolId: PoolId;
  loanKey: string;
  price: number;
  downPayment: number;
  borrower: string;
  seller: string;
  /** Null when the link can still be signed; otherwise why it can't. */
  problem: string | null;
}

export class ClientError extends Error {}

export const LATE_STATUSES: LoanStatus[] = ["Late1", "Late2"];
export const LIVE_STATUSES: LoanStatus[] = ["Funded", "Active", "Late1", "Late2", "Defaulted"];

/**
 * Pool metrics, same formulas as the doc:
 *   Senior NAV = idle cash + outstanding principal − max(0, provision − first-loss vault − reserve)
 *   Share price = Senior NAV / total shares
 */
export function computeMetrics(pool: PoolState, loans: Loan[]): PoolMetrics {
  const p = pool.params;
  const seniorImpairment = Math.max(0, pool.lossProvision - pool.firstLossVault - pool.reserve);
  const seniorNav = pool.idleCash + pool.outstandingPrincipal - seniorImpairment;
  const sharePrice = pool.totalShares > 0 ? seniorNav / pool.totalShares : 1;
  const firstLossRemaining = Math.max(0, pool.firstLossVault - pool.lossProvision);
  const reserveRemaining = Math.max(0, pool.reserve - Math.max(0, pool.lossProvision - pool.firstLossVault));

  const live = loans.filter((l) => l.poolId === p.id && LIVE_STATUSES.includes(l.status));
  const late = live.filter((l) => LATE_STATUSES.includes(l.status));
  const defaulted = live.filter((l) => l.status === "Defaulted");
  const badPrincipal = [...late, ...defaulted].reduce((s, l) => s + l.remainingPrincipal, 0);
  const delinquencyRatio = pool.outstandingPrincipal > 0 ? badPrincipal / pool.outstandingPrincipal : 0;

  let brakeReason: string | null = null;
  if (delinquencyRatio > p.brakeDelinquency) {
    brakeReason = `Late and defaulted loans are ${(delinquencyRatio * 100).toFixed(1)}% of principal (limit ${p.brakeDelinquency * 100}%)`;
  } else if (pool.outstandingPrincipal > 0 && pool.reserve < p.brakeReserveMin * pool.outstandingPrincipal) {
    brakeReason = `Reserve is below ${p.brakeReserveMin * 100}% of outstanding principal`;
  }

  // Assumption until the program is final: the buffer is 10% of the senior pool, kept as cash.
  const buffer = p.liquidityBuffer * seniorNav;
  const lendableCash = Math.max(0, pool.idleCash - buffer);

  return {
    seniorNav,
    sharePrice,
    seniorImpairment,
    firstLossRemaining,
    reserveRemaining,
    delinquencyRatio,
    brakeOn: brakeReason !== null,
    brakeReason,
    lendableCash,
    loansActive: live.filter((l) => l.status === "Active").length,
    loansLate: late.length,
    loansDefaulted: defaulted.length,
  };
}

/** "GH-0042" style public id. The pool is shown next to it. */
export function loanLabel(loan: Pick<Loan, "seq" | "poolId">): string {
  return `GH-${loan.poolId === "vehicle" ? "V" : ""}${String(loan.seq).padStart(4, "0")}`;
}

export function loanKey(poolId: PoolId, seq: number): string {
  return `${poolId}-${seq}`;
}

export function parseLoanKey(key: string): { poolId: PoolId; seq: number } | null {
  const m = /^(house|vehicle)-(\d+)$/.exec(key);
  return m ? { poolId: m[1] as PoolId, seq: Number(m[2]) } : null;
}
