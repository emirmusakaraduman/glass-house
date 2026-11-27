// Pool / Loan hesaplarının Borsh düzeni — state.rs (STATE.md v0.1) ile alan alan aynı sırada.
// IDL'de henüz Pool/Loan yok (hiçbir instruction bunları kullanmıyor), bu yüzden elle kodlandı.
// state.rs değişirse BURASI da güncellenmeli; tests/layout.test.ts boyutları kilitler.

import { createHash } from "crypto";
import { PublicKey } from "@solana/web3.js";

export enum AssetType {
  House = 0,
  Vehicle = 1,
}

export enum PoolStatus {
  Active = 0,
  Paused = 1,
}

/** state.rs `LoanStatus` ile aynı sıra (Borsh enum indeksi). */
export enum LoanStatus {
  Pending = 0,
  Approved = 1,
  Rejected = 2,
  Funded = 3,
  Cancelled = 4,
  Active = 5,
  Late1 = 6,
  Late2 = 7,
  Defaulted = 8,
  Recovered = 9,
  PaidOff = 10,
}

export interface PoolState {
  admin: PublicKey;
  assetType: AssetType;
  underwriter: PublicKey;
  titleAgent: PublicKey;
  recoveryAgent: PublicKey;
  usdcMint: PublicKey;
  platformTreasury: PublicKey;
  poolId: bigint;
  maxLtvBps: number;
  rateBps: number;
  termMonths: number;
  recoveryCoeffBps: number;
  graceSeconds: bigint;
  periodSeconds: bigint;
  provisionBps: [number, number, number, number];
  bufferBps: number;
  brakeLateBps: number;
  brakeReserveBps: number;
  minFirstLossBps: number;
  entryExitFeeBps: number;
  minRecoveryBps: number;
  titleTimeoutSeconds: bigint;
  nextLoanId: bigint;
  idleCash: bigint;
  totalOutstanding: bigint;
  lateDefaultPrincipal: bigint;
  lossProvision: bigint;
  firstLossBalance: bigint;
  reserveBalance: bigint;
  reservePending: bigint;
  totalShares: bigint;
  withdrawHead: bigint;
  withdrawTail: bigint;
  status: PoolStatus;
  bump: number;
  vaultBump: number;
  firstLossBump: number;
  reserveBump: number;
  shareMintBump: number;
  reserved: Uint8Array; // 64
}

export interface LoanState {
  id: bigint;
  pool: PublicKey;
  borrower: PublicKey;
  seller: PublicKey;
  price: bigint;
  appraisedValue: bigint;
  principal: bigint;
  rateBps: number;
  installment: bigint;
  remainingPrincipal: bigint;
  paidInstallments: number;
  missedInstallments: number;
  nextDue: bigint;
  status: LoanStatus;
  docHash: Uint8Array; // 32
  assetRefHash: Uint8Array; // 32
  valueBand: bigint;
  regionCode: number;
  incomeOk: boolean;
  currencyOk: boolean;
  provisionAmount: bigint;
  lateFeeAccrued: bigint;
  lastProcessedPeriod: bigint;
  fundedAt: bigint;
  titleDeadline: bigint;
  bump: number;
  escrowBump: number;
  collateralBump: number;
  reserved: Uint8Array; // 64
}

/** 8 + InitSpace. Rust'taki `8 + Pool::INIT_SPACE` ile aynı olmalı. */
export const POOL_SIZE = 8 + 32 + 1 + 32 * 5 + 8 + 2 * 4 + 8 * 2 + 2 * 4 + 2 * 6 + 8 + 8 * 11 + 1 + 5 + 64;
/** 8 + InitSpace. Rust'taki `8 + Loan::INIT_SPACE` ile aynı olmalı. */
export const LOAN_SIZE =
  8 + 8 + 32 * 3 + 8 * 3 + 2 + 8 * 2 + 2 * 2 + 8 + 1 + 32 * 2 + 8 + 2 + 1 + 1 + 8 * 3 + 8 * 2 + 3 + 64;

/** Anchor hesap ayırıcı: sha256("account:<Ad>")[0..8]. */
export function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

class Writer {
  private buf: Buffer;
  private off = 0;
  constructor(size: number) {
    this.buf = Buffer.alloc(size);
  }
  bytes(b: Uint8Array, len: number) {
    if (b.length !== len) throw new Error(`beklenen ${len} bayt, gelen ${b.length}`);
    Buffer.from(b).copy(this.buf, this.off);
    this.off += len;
  }
  u8(v: number) {
    this.buf.writeUInt8(v, this.off);
    this.off += 1;
  }
  bool(v: boolean) {
    this.u8(v ? 1 : 0);
  }
  u16(v: number) {
    this.buf.writeUInt16LE(v, this.off);
    this.off += 2;
  }
  u64(v: bigint) {
    this.buf.writeBigUInt64LE(v, this.off);
    this.off += 8;
  }
  i64(v: bigint) {
    this.buf.writeBigInt64LE(v, this.off);
    this.off += 8;
  }
  key(k: PublicKey) {
    this.bytes(k.toBytes(), 32);
  }
  done(): Buffer {
    if (this.off !== this.buf.length) {
      throw new Error(`düzen boyutu uyuşmuyor: yazılan ${this.off}, beklenen ${this.buf.length}`);
    }
    return this.buf;
  }
}

class Reader {
  private off = 0;
  constructor(private buf: Buffer) {}
  bytes(len: number): Uint8Array {
    const out = new Uint8Array(this.buf.subarray(this.off, this.off + len));
    this.off += len;
    return out;
  }
  u8(): number {
    return this.buf.readUInt8(this.off++);
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  u16(): number {
    const v = this.buf.readUInt16LE(this.off);
    this.off += 2;
    return v;
  }
  u64(): bigint {
    const v = this.buf.readBigUInt64LE(this.off);
    this.off += 8;
    return v;
  }
  i64(): bigint {
    const v = this.buf.readBigInt64LE(this.off);
    this.off += 8;
    return v;
  }
  key(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
}

function checkDisc(data: Buffer, name: string) {
  if (!data.subarray(0, 8).equals(accountDiscriminator(name))) {
    throw new Error(`${name} ayırıcısı uyuşmuyor`);
  }
}

export function encodePool(p: PoolState): Buffer {
  const w = new Writer(POOL_SIZE);
  w.bytes(accountDiscriminator("Pool"), 8);
  w.key(p.admin);
  w.u8(p.assetType);
  w.key(p.underwriter);
  w.key(p.titleAgent);
  w.key(p.recoveryAgent);
  w.key(p.usdcMint);
  w.key(p.platformTreasury);
  w.u64(p.poolId);
  w.u16(p.maxLtvBps);
  w.u16(p.rateBps);
  w.u16(p.termMonths);
  w.u16(p.recoveryCoeffBps);
  w.i64(p.graceSeconds);
  w.i64(p.periodSeconds);
  for (const b of p.provisionBps) w.u16(b);
  w.u16(p.bufferBps);
  w.u16(p.brakeLateBps);
  w.u16(p.brakeReserveBps);
  w.u16(p.minFirstLossBps);
  w.u16(p.entryExitFeeBps);
  w.u16(p.minRecoveryBps);
  w.i64(p.titleTimeoutSeconds);
  w.u64(p.nextLoanId);
  w.u64(p.idleCash);
  w.u64(p.totalOutstanding);
  w.u64(p.lateDefaultPrincipal);
  w.u64(p.lossProvision);
  w.u64(p.firstLossBalance);
  w.u64(p.reserveBalance);
  w.u64(p.reservePending);
  w.u64(p.totalShares);
  w.u64(p.withdrawHead);
  w.u64(p.withdrawTail);
  w.u8(p.status);
  w.u8(p.bump);
  w.u8(p.vaultBump);
  w.u8(p.firstLossBump);
  w.u8(p.reserveBump);
  w.u8(p.shareMintBump);
  w.bytes(p.reserved, 64);
  return w.done();
}

export function decodePool(data: Buffer): PoolState {
  checkDisc(data, "Pool");
  const r = new Reader(data.subarray(8));
  return {
    admin: r.key(),
    assetType: r.u8() as AssetType,
    underwriter: r.key(),
    titleAgent: r.key(),
    recoveryAgent: r.key(),
    usdcMint: r.key(),
    platformTreasury: r.key(),
    poolId: r.u64(),
    maxLtvBps: r.u16(),
    rateBps: r.u16(),
    termMonths: r.u16(),
    recoveryCoeffBps: r.u16(),
    graceSeconds: r.i64(),
    periodSeconds: r.i64(),
    provisionBps: [r.u16(), r.u16(), r.u16(), r.u16()],
    bufferBps: r.u16(),
    brakeLateBps: r.u16(),
    brakeReserveBps: r.u16(),
    minFirstLossBps: r.u16(),
    entryExitFeeBps: r.u16(),
    minRecoveryBps: r.u16(),
    titleTimeoutSeconds: r.i64(),
    nextLoanId: r.u64(),
    idleCash: r.u64(),
    totalOutstanding: r.u64(),
    lateDefaultPrincipal: r.u64(),
    lossProvision: r.u64(),
    firstLossBalance: r.u64(),
    reserveBalance: r.u64(),
    reservePending: r.u64(),
    totalShares: r.u64(),
    withdrawHead: r.u64(),
    withdrawTail: r.u64(),
    status: r.u8() as PoolStatus,
    bump: r.u8(),
    vaultBump: r.u8(),
    firstLossBump: r.u8(),
    reserveBump: r.u8(),
    shareMintBump: r.u8(),
    reserved: r.bytes(64),
  };
}

export function encodeLoan(l: LoanState): Buffer {
  const w = new Writer(LOAN_SIZE);
  w.bytes(accountDiscriminator("Loan"), 8);
  w.u64(l.id);
  w.key(l.pool);
  w.key(l.borrower);
  w.key(l.seller);
  w.u64(l.price);
  w.u64(l.appraisedValue);
  w.u64(l.principal);
  w.u16(l.rateBps);
  w.u64(l.installment);
  w.u64(l.remainingPrincipal);
  w.u16(l.paidInstallments);
  w.u16(l.missedInstallments);
  w.i64(l.nextDue);
  w.u8(l.status);
  w.bytes(l.docHash, 32);
  w.bytes(l.assetRefHash, 32);
  w.u64(l.valueBand);
  w.u16(l.regionCode);
  w.bool(l.incomeOk);
  w.bool(l.currencyOk);
  w.u64(l.provisionAmount);
  w.u64(l.lateFeeAccrued);
  w.u64(l.lastProcessedPeriod);
  w.i64(l.fundedAt);
  w.i64(l.titleDeadline);
  w.u8(l.bump);
  w.u8(l.escrowBump);
  w.u8(l.collateralBump);
  w.bytes(l.reserved, 64);
  return w.done();
}

export function decodeLoan(data: Buffer): LoanState {
  checkDisc(data, "Loan");
  const r = new Reader(data.subarray(8));
  return {
    id: r.u64(),
    pool: r.key(),
    borrower: r.key(),
    seller: r.key(),
    price: r.u64(),
    appraisedValue: r.u64(),
    principal: r.u64(),
    rateBps: r.u16(),
    installment: r.u64(),
    remainingPrincipal: r.u64(),
    paidInstallments: r.u16(),
    missedInstallments: r.u16(),
    nextDue: r.i64(),
    status: r.u8() as LoanStatus,
    docHash: r.bytes(32),
    assetRefHash: r.bytes(32),
    valueBand: r.u64(),
    regionCode: r.u16(),
    incomeOk: r.bool(),
    currencyOk: r.bool(),
    provisionAmount: r.u64(),
    lateFeeAccrued: r.u64(),
    lastProcessedPeriod: r.u64(),
    fundedAt: r.i64(),
    titleDeadline: r.i64(),
    bump: r.u8(),
    escrowBump: r.u8(),
    collateralBump: r.u8(),
    reserved: r.bytes(64),
  };
}
