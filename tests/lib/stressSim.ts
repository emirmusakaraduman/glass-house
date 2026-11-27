// Stres simülasyonu motoru — gerçek program üzerinde (LiteSVM). SAHİBİ: Kişi 2.
// Hem tests/stress.test.ts hem scripts/stress.ts bunu kullanır.
//
// Senaryo: 100 Active kredi → 20'si temerrüt (saat 3 taksit + grace ilerler, crank'i "yabancı" çağırır)
// → ~15 ay faiz birikir → satışlar record_recovery ile işlenir. Satış geliri = değer × (1 − düşüş) × (1 − masraf).
// Programın KENDİ hesabı kullanılır (crank_loan, record_recovery); burada yalnızca durum kurulur ve ölçülür.

import { PublicKey } from "@solana/web3.js";
import {
  assertInvariants,
  crankLoanIx,
  createPool,
  fundUsdc,
  HOUSE_PARAMS,
  loanMath,
  LoanStatus,
  MODE_2008_PARAMS,
  patchPool,
  PoolHandle,
  PoolParams,
  VEHICLE_PARAMS,
  readLoan,
  readPool,
  recordRecoveryIx,
  sendTx,
  setupEnv,
  TestEnv,
  USDC,
  warp,
  writeLoanFixture,
  writeMint,
} from "../helpers";
import { decodeEvent, RECOVERY_RECORDED } from "./events";

export type PoolKind = "house" | "2008" | "vehicle";

export interface ScenarioInput {
  pool: PoolKind;
  /** Satış masrafı, % (satış fiyatı üzerinden). */
  costPct: number;
  /** Varlık (ev/araç) fiyatı düşüşü, % (değerlemeye göre). */
  dropPct: number;
  /** Düşüş, baz puan (kırılma noktası aramasında ince ayar için); verilirse `dropPct` yerine kullanılır. */
  dropBps?: number;
  /** Temerrüde düşen kredi sayısı. Varsayılan 20. */
  defaults?: number;
  /** Toplam kredi sayısı. Varsayılan 100. */
  loans?: number;
}

/** scripts/out/stress.json içindeki `scenarios[]` satırı. Alan adları SABİT (frontend okur). */
export interface ScenarioRow {
  pool: PoolKind;
  costPct: number;
  dropPct: number;
  defaults: number;
  /** Temerrüde düşen kredi başına ortalama zarar (USD): alacak − teminat − satış geliri. */
  perLoanShortfall: number;
  /** Tüm temerrütlerin toplam zararı (USD). */
  totalLoss: number;
  /** Zararın ilk zarar kasası + yedek fonun yediği kısmı (USD). */
  firstLossAndReserveUsed: number;
  seniorSharePriceBefore: number;
  seniorSharePriceAfter: number;
  /** Senior yatırımcıya yansıyan zarar (USD). */
  investorLoss: number;
  /** investorLoss / kriz öncesi senior NAV × 100. */
  investorLossPct: number;
}

/** Test ve notlar için ek ölçümler (JSON şemasının parçası DEĞİL). */
export interface ScenarioDetail {
  navBefore: number;
  navAfter: number;
  navAfterCrank: number;
  sharePriceAfterCrank: number;
  portfolioPrincipal: number;
  defaultedPrincipal: number;
  provisionAtCrank: number;
  firstLossStart: number;
  reserveStart: number;
  coSignedRecoveries: number;
}

const usd = (v: bigint): number => Number(v) / 1e6;
const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;

interface PoolSetup {
  params: PoolParams;
  firstLoss: bigint;
  reserve: bigint;
  /** Kredilere verilmeyen serbest nakit (likidite tamponu ≈ %10). */
  idle: bigint;
}

function setupFor(kind: PoolKind): PoolSetup {
  if (kind === "house") {
    // Ev: LTV %70, faiz %7 sabit, 240 ay; ilk zarar kasası 350.000, yedek 35.000, tampon %10.
    return { params: HOUSE_PARAMS, firstLoss: 350_000n * USDC, reserve: 35_000n * USDC, idle: 800_000n * USDC };
  }
  if (kind === "vehicle") {
    // Araç (PDF tahmini): LTV %60, faiz %9, 60 ay, katsayı 0,54; 100 kredi × 12.000 = 1.200.000 USD,
    // ilk zarar kasası 60.000 (%5), yedek 6.000 (ücretin yarısı), tampon %10.
    return { params: VEHICLE_PARAMS, firstLoss: 60_000n * USDC, reserve: 6_000n * USDC, idle: 140_000n * USDC };
  }
  // 2008 modu: LTV %97, ilk zarar kasası 0, yedek 0; aynı program, create_pool parametreleriyle.
  return { params: MODE_2008_PARAMS, firstLoss: 0n, reserve: 0n, idle: 1_100_000n * USDC };
}

const navOf = (env: TestEnv, pool: PoolHandle): bigint => loanMath.seniorNav(readPool(env, pool.pool));

function priceOf(env: TestEnv, pool: PoolHandle): number {
  const p = readPool(env, pool.pool);
  return Number(loanMath.sharePrice(loanMath.seniorNav(p), p.totalShares)) / 1e18;
}

export async function runScenario(input: ScenarioInput): Promise<{ row: ScenarioRow; detail: ScenarioDetail }> {
  const nLoans = input.loans ?? 100;
  const nDefaults = input.defaults ?? 20;
  const s = setupFor(input.pool);

  const env = setupEnv({ solPerWallet: 1_000 });
  const pool = createPool(env, s.params, { liquidity: s.idle, firstLoss: s.firstLoss, reserve: s.reserve });

  // ---- 1) N kredi, hepsi Active (ev 100.000 USD; anapara LTV × değer) ----
  const loans: PublicKey[] = [];
  for (let i = 0; i < nLoans; i++) {
    loans.push(writeLoanFixture(env, pool, { status: LoanStatus.Active }).loan);
  }
  // Pay fiyatı kriz öncesi tam 1,0 olsun: toplam pay = senior NAV.
  const nav0 = navOf(env, pool);
  patchPool(env, pool.pool, { totalShares: nav0 });
  writeMint(env, pool.shareMint, pool.pool, nav0);
  assertInvariants(env, pool, loans);
  const priceBefore = priceOf(env, pool);
  const portfolio = readPool(env, pool.pool).totalOutstanding;

  // ---- 2) 3 taksit + grace ilerle, temerrüde düşenleri "yabancı" crank'ler ----
  const { periodSeconds, graceSeconds } = s.params;
  const defaulted = loans.slice(0, nDefaults);
  warp(env, periodSeconds + graceSeconds + 2n * periodSeconds); // ilk vade + grace + 2 dönem → kaçırılan = 3
  const stranger = env.wallets.stranger;
  for (const loan of defaulted) {
    sendTx(env, [await crankLoanIx(env, pool, loan, stranger.publicKey)], [stranger]);
  }
  assertInvariants(env, pool, loans);
  const navAfterCrank = navOf(env, pool);
  const priceAfterCrank = priceOf(env, pool);
  const provision = readPool(env, pool.pool).lossProvision;
  let defaultedPrincipal = 0n;
  for (const loan of defaulted) {
    const l = readLoan(env, loan);
    if (l.status !== LoanStatus.Defaulted) throw new Error(`kredi ${l.id} Defaulted olmadı (${l.status})`);
    defaultedPrincipal += l.remainingPrincipal;
  }

  // ---- 3) ~15 ay faiz birikmiş say (3 + 12), satışları işle ----
  warp(env, 12n * periodSeconds);
  const agent = env.recoveryAgent;
  const admin = env.wallets.platform;
  fundUsdc(env, agent.publicKey, BigInt(nDefaults) * 200_000n * USDC);

  let totalLoss = 0n;
  let flUsed = 0n;
  let resUsed = 0n;
  let seniorLoss = 0n;
  let coSigned = 0;
  for (const loan of defaulted) {
    const l = readLoan(env, loan);
    const value = l.price < l.appraisedValue ? l.price : l.appraisedValue;
    // Satış geliri: değer × (1 − düşüş) × (1 − masraf).
    const dropBps = input.dropBps ?? input.dropPct * 100;
    const proceeds = (value * BigInt(10_000 - dropBps) * BigInt(100 - input.costPct)) / 1_000_000n;
    const floor = (value * BigInt(readPool(env, pool.pool).minRecoveryBps)) / 10_000n;
    const needCo = proceeds < floor; // alt sınırın altında ikinci imza (admin) gerekir
    if (needCo) coSigned++;
    const ix = await recordRecoveryIx(env, pool, loan, proceeds, { coSigner: needCo ? admin.publicKey : null });
    const res = sendTx(env, [ix], needCo ? [agent, admin] : [agent]);
    const ev = decodeEvent(env, res.logs(), "RecoveryRecorded", RECOVERY_RECORDED);
    totalLoss += ev.loss;
    flUsed += ev.firstLossUsed;
    resUsed += ev.reserveUsed;
    seniorLoss += ev.seniorLoss;
  }
  assertInvariants(env, pool, loans);
  const navAfter = navOf(env, pool);
  const priceAfter = priceOf(env, pool);

  const row: ScenarioRow = {
    pool: input.pool,
    costPct: input.costPct,
    dropPct: input.dropPct,
    defaults: nDefaults,
    perLoanShortfall: round(usd(totalLoss) / nDefaults, 2),
    totalLoss: round(usd(totalLoss), 2),
    firstLossAndReserveUsed: round(usd(flUsed + resUsed), 2),
    seniorSharePriceBefore: round(priceBefore, 6),
    seniorSharePriceAfter: round(priceAfter, 6),
    investorLoss: round(usd(seniorLoss), 2),
    investorLossPct: round((usd(seniorLoss) / usd(nav0)) * 100, 4),
  };
  const detail: ScenarioDetail = {
    navBefore: usd(nav0),
    navAfter: usd(navAfter),
    navAfterCrank: usd(navAfterCrank),
    sharePriceAfterCrank: round(priceAfterCrank, 6),
    portfolioPrincipal: usd(portfolio),
    defaultedPrincipal: usd(defaultedPrincipal),
    provisionAtCrank: usd(provision),
    firstLossStart: usd(s.firstLoss),
    reserveStart: usd(s.reserve),
    coSignedRecoveries: coSigned,
  };
  return { row, detail };
}

/** Ev ve 2008 havuzu × masraf (%10, %15, %20) × düşüş (%30, %40). */
export const MATRIX: Pick<ScenarioInput, "costPct" | "dropPct">[] = [10, 15, 20].flatMap((costPct) =>
  [30, 40].map((dropPct) => ({ costPct, dropPct })),
);

/** Araç havuzu (tahmin): masraf (%10, %15, %20) × düşüş (%30, %40, %50). */
export const VEHICLE_MATRIX: Pick<ScenarioInput, "costPct" | "dropPct">[] = [10, 15, 20].flatMap((costPct) =>
  [30, 40, 50].map((dropPct) => ({ costPct, dropPct })),
);

export interface BreakEven {
  pool: PoolKind;
  costPct: number;
  defaults: number;
  /** Yatırımcının zarar görmeye başladığı düşüş, % (0,1 puan hassasiyet). */
  dropPct: number;
}

/** İkiye bölme: yatırımcıya zarar yansımaya başlayan en küçük düşüş (zincirde ölçülür). */
export async function findBreakEven(pool: PoolKind, costPct: number, defaults: number): Promise<BreakEven> {
  let lo = 1_000; // %10: yatırımcı zararı 0 varsayılır
  let hi = 8_000; // %80: zarar var varsayılır
  for (let i = 0; i < 10; i++) {
    const mid = Math.round((lo + hi) / 2);
    const { row } = await runScenario({ pool, costPct, dropPct: 0, dropBps: mid, defaults });
    if (row.investorLoss > 0) hi = mid;
    else lo = mid;
  }
  return { pool, costPct, defaults, dropPct: Math.round(((lo + hi) / 2) / 10) / 10 };
}

export async function runAll(): Promise<{
  rows: ScenarioRow[];
  details: ScenarioDetail[];
  breakEven: BreakEven[];
}> {
  const rows: ScenarioRow[] = [];
  const details: ScenarioDetail[] = [];
  const add = async (input: ScenarioInput) => {
    const { row, detail } = await runScenario(input);
    rows.push(row);
    details.push(detail);
  };
  // Ev ve 2008 modu, 20 temerrüt.
  for (const pool of ["house", "2008"] as PoolKind[]) for (const m of MATRIX) await add({ pool, ...m });
  // Araç havuzu (tahmin), 20 temerrüt.
  for (const m of VEHICLE_MATRIX) await add({ pool: "vehicle", ...m });
  // 30 temerrüt: ev %40 düşüş, araç %50 düşüş (PDF'teki ek sütun).
  for (const costPct of [10, 15, 20]) {
    await add({ pool: "house", costPct, dropPct: 40, defaults: 30 });
    await add({ pool: "vehicle", costPct, dropPct: 50, defaults: 30 });
  }
  // Kırılma noktaları (20 temerrüt).
  const breakEven: BreakEven[] = [];
  for (const pool of ["house", "vehicle"] as PoolKind[]) {
    for (const costPct of [10, 15, 20]) breakEven.push(await findBreakEven(pool, costPct, 20));
  }
  return { rows, details, breakEven };
}
