// Domain types for the GlassHouse frontend.
// They mirror the on-chain accounts described in the v4 design doc (Pool, Loan, WithdrawRequest).
// Amounts are plain USD numbers in the UI; the chain client converts from micro-USDC (6 decimals).

export type AssetType = "house" | "vehicle";

/** Pool id used in URLs and the data layer. "house" and "vehicle" are the two real pools. */
export type PoolId = "house" | "vehicle";

export interface PoolParams {
  id: PoolId;
  assetType: AssetType;
  name: string;
  /** Max loan-to-value, e.g. 0.70 for houses. */
  maxLtv: number;
  /** Fixed annual interest the borrower pays, e.g. 0.07. */
  annualRate: number;
  /** Share of the annual rate that stays in the pool (investors), e.g. 0.06. */
  poolRate: number;
  /** Share of the annual rate that goes to the platform, e.g. 0.005. */
  platformRate: number;
  /** Share of the annual rate that goes to the reserve fund, e.g. 0.005. */
  reserveRate: number;
  termMonths: number;
  /** Max installment / free income. */
  maxDti: number;
  /** Origination fee as a share of the loan, paid upfront. */
  originationFee: number;
  /** Collateral deposit, in installments. */
  collateralInstallments: number;
  /** Recovery coefficient k used for Defaulted provisions (0.63 house, 0.54 vehicle). */
  recoveryCoeff: number;
  /** Provision per status: [Active, Late1, Late2, Defaulted floor]. */
  provisionRates: [number, number, number, number];
  /** Liquidity buffer kept out of lending. */
  liquidityBuffer: number;
  /** New loans stop when late+default ratio exceeds this. */
  brakeDelinquency: number;
  /** New loans stop when reserve falls below this share of outstanding principal. */
  brakeReserveMin: number;
  /** Late fee as a share of the installment, added at Late-1. */
  lateFee: number;
  /** First-loss vault target as a share of outstanding principal. */
  firstLossTarget: number;
  /** Value band width for on-chain disclosure (50k house, 5k vehicle). */
  valueBand: number;
  /** Demo timing: one "month" in seconds and the grace period. */
  periodSeconds: number;
  graceSeconds: number;
  /** Hackathon-only: estimated gross target yield shown to investors. */
  targetYield: number;
}

export type LoanStatus =
  | "Pending"
  | "Rejected"
  | "Funded"
  | "Cancelled"
  | "Active"
  | "Late1"
  | "Late2"
  | "Defaulted"
  | "Recovered"
  | "PaidOff";

export interface Loan {
  /** Data-layer key, e.g. "house-42". */
  key: string;
  poolId: PoolId;
  /** Sequential id from the pool counter (next_loan_id). */
  seq: number;
  status: LoanStatus;
  /** Listing / sale price. */
  price: number;
  /** Underwriter's signed value, null until approve_loan. */
  appraisal: number | null;
  downPayment: number;
  principal: number;
  remainingPrincipal: number;
  annualRate: number;
  termMonths: number;
  installment: number;
  paidInstallments: number;
  missedInstallments: number;
  /** Unix ms of the next due date (null before Active). */
  nextDueAt: number | null;
  /** Late fee owed, added at Late-1. */
  lateFeeDue: number;
  /** Collateral still locked in CollateralEscrow. */
  collateral: number;
  originationFee: number;
  /** Current provision held against this loan. */
  provision: number;
  /** Interest accrued but unpaid (for Defaulted provision). */
  accruedInterest: number;
  /** City-level region only; never a full address. */
  region: string;
  /** Pseudonymous wallets (a fresh borrower wallet per loan). */
  borrower: string;
  seller: string;
  /** Salted hashes; the documents themselves stay off-chain. */
  docHash: string | null;
  assetRefHash: string | null;
  createdAt: number;
  /** Simulated borrower that always pays on time (mock data only). */
  autopay?: boolean;
  events: LoanEvent[];
}

export interface LoanEvent {
  at: number;
  kind:
    | "applied"
    | "approved"
    | "rejected"
    | "funded"
    | "title_confirmed"
    | "repaid"
    | "late1"
    | "late2"
    | "defaulted"
    | "recovered"
    | "paid_off"
    | "cancelled";
  amount?: number;
  note?: string;
  signature?: string;
  /** Wallet that sent the transaction (for crank: proves "anyone" can call it). */
  by?: string;
}

export interface PoolState {
  params: PoolParams;
  /** Internal counter of free cash in the vault (not the raw vault balance). */
  idleCash: number;
  /** Investors' outstanding principal across active loans. */
  outstandingPrincipal: number;
  /** Sum of loan provisions. */
  lossProvision: number;
  firstLossVault: number;
  reserve: number;
  platformFees: number;
  totalShares: number;
  /** Cash held in loan escrows awaiting title confirmation. */
  escrowed: number;
  nextLoanSeq: number;
  withdrawQueue: WithdrawRequest[];
}

export interface WithdrawRequest {
  seq: number;
  owner: string;
  shares: number;
  requestedAt: number;
}

export interface PoolMetrics {
  seniorNav: number;
  sharePrice: number;
  /** Provision not covered by first-loss vault + reserve (hits senior NAV). */
  seniorImpairment: number;
  firstLossRemaining: number;
  reserveRemaining: number;
  delinquencyRatio: number;
  brakeOn: boolean;
  brakeReason: string | null;
  lendableCash: number;
  loansActive: number;
  loansLate: number;
  loansDefaulted: number;
}

export interface SharePricePoint {
  at: number;
  price: number;
}

export interface InvestorPosition {
  owner: string;
  shares: number;
  lockedShares: number;
  value: number;
}

export interface TxResult {
  signature: string;
  /** True when the signature is a mock id and has no Explorer page. */
  mock: boolean;
}
