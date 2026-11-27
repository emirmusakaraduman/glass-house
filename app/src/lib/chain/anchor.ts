import { PublicKey } from "@solana/web3.js";
import type { LoanStatus } from "../types";

// Shared helpers for the chain client (src/lib/chain/chain.ts): unit conversion, status
// mapping and PDA seeds. The IDL is synced from deployments/idl with `npm run idl:sync`.

export const USDC_DECIMALS = 6;

/** micro-USDC (u64 as BN or bigint or number) → USD number for display. */
export function fromMicro(v: { toString(): string } | bigint | number): number {
  return Number(v.toString()) / 10 ** USDC_DECIMALS;
}

/** USD number → micro-USDC as bigint (round down; the program rounds in the protocol's favor). */
export function toMicro(usd: number): bigint {
  return BigInt(Math.floor(usd * 10 ** USDC_DECIMALS));
}

/** Anchor decodes Rust enums as { active: {} }. */
export function mapStatus(raw: Record<string, unknown>): LoanStatus {
  const k = Object.keys(raw)[0]?.toLowerCase();
  const table: Record<string, LoanStatus> = {
    pending: "Pending",
    // The program has a separate Approved status (docs/STATE.md). The UI models it as Pending
    // with an appraisal set, so StatusBadge shows "Approved" and the Fund button appears.
    approved: "Pending",
    rejected: "Rejected",
    funded: "Funded",
    cancelled: "Cancelled",
    active: "Active",
    late1: "Late1",
    late2: "Late2",
    defaulted: "Defaulted",
    recovered: "Recovered",
    paidoff: "PaidOff",
  };
  const s = k ? table[k] : undefined;
  if (!s) throw new Error(`Unknown loan status from chain: ${JSON.stringify(raw)}`);
  return s;
}

/**
 * PDA seeds from the v4 doc ("Hesaplar"). Confirm the exact seed bytes with the program
 * (string prefixes, and whether the pool id / loan id are u8, u16 or u64 little-endian).
 */
export function pdas(programId: PublicKey) {
  const find = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  const u64 = (n: number | bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  return {
    pool: (admin: PublicKey, poolId: number | bigint) => find([Buffer.from("pool"), admin.toBuffer(), u64(poolId)]),
    vault: (pool: PublicKey) => find([Buffer.from("vault"), pool.toBuffer()]),
    firstLoss: (pool: PublicKey) => find([Buffer.from("first_loss"), pool.toBuffer()]),
    reserve: (pool: PublicKey) => find([Buffer.from("reserve"), pool.toBuffer()]),
    shareMint: (pool: PublicKey) => find([Buffer.from("shares"), pool.toBuffer()]),
    loan: (pool: PublicKey, loanId: number | bigint) => find([Buffer.from("loan"), pool.toBuffer(), u64(loanId)]),
    loanEscrow: (loan: PublicKey) => find([Buffer.from("escrow"), loan.toBuffer()]),
    collateral: (loan: PublicKey) => find([Buffer.from("collateral"), loan.toBuffer()]),
    withdrawRequest: (pool: PublicKey, seq: number | bigint) => find([Buffer.from("wreq"), pool.toBuffer(), u64(seq)]),
    shareEscrow: (pool: PublicKey) => find([Buffer.from("share_escrow"), pool.toBuffer()]),
  };
}

export function explorerTx(signature: string, cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function explorerAddress(address: string, cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") {
  return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
}
