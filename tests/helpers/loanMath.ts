// programs/glasshouse/src/math.rs ve nav.rs'nin birebir BigInt karşılığı.
// Kişi 2 zincir sonuçlarını ±1 micro-USDC ile bu fonksiyonlara karşı doğrular.
// Birimler: tutar = micro-USDC (bigint), oran = bps, ölçek = 1e18.

export const SCALE = 1_000_000_000_000_000_000n;
export const BPS = 10_000n;
export const VIRTUAL_SHARES = 1_000_000n;
export const VIRTUAL_ASSETS = 1_000_000n;
export const ORIGINATION_FEE_BPS = 100n;
export const COLLATERAL_INSTALLMENTS = 3n;
export const PLATFORM_INTEREST_BPS = 50n;
export const RESERVE_INTEREST_BPS = 50n;

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export const mulDiv = (a: bigint, b: bigint, d: bigint): bigint => {
  if (d === 0n) throw new Error("MathOverflow");
  const v = (a * b) / d;
  if (v > U128_MAX) throw new Error("MathOverflow");
  return v;
};

export const mulDivUp = (a: bigint, b: bigint, d: bigint): bigint => {
  if (d === 0n) throw new Error("MathOverflow");
  const v = (a * b + d - 1n) / d;
  if (v > U128_MAX) throw new Error("MathOverflow");
  return v;
};

const toU64 = (v: bigint): bigint => {
  if (v > U64_MAX) throw new Error("MathOverflow");
  return v;
};

export const powScaled = (base: bigint, exp: number): bigint => {
  let result = SCALE;
  let b = base;
  let e = exp;
  while (e > 0) {
    if (e & 1) result = mulDiv(result, b, SCALE);
    e >>= 1;
    if (e > 0) b = mulDiv(b, b, SCALE);
  }
  return result;
};

export const monthlyRate = (rateBps: number | bigint): bigint =>
  mulDiv(BigInt(rateBps), SCALE, BPS * 12n);

/** M = P·r·x/(x−1), yukarı yuvarlanır. */
export const installment = (
  principal: bigint,
  rateBps: number | bigint,
  termMonths: number,
): bigint => {
  if (principal === 0n || termMonths === 0) throw new Error("ZeroAmount");
  const r = monthlyRate(rateBps);
  const x = powScaled(SCALE + r, termMonths);
  if (x <= SCALE) throw new Error("MathOverflow");
  const num = principal * r * x;
  const den = (x - SCALE) * SCALE;
  return toU64((num + den - 1n) / den);
};

export const interestForPeriod = (remaining: bigint, rateBps: number | bigint): bigint =>
  toU64(mulDivUp(remaining, monthlyRate(rateBps), SCALE));

export interface PaymentSplit {
  lateFee: bigint;
  interest: bigint;
  principal: bigint;
  unapplied: bigint;
}

/** Sıra: gecikme bedeli → faiz → anapara. */
export const splitPayment = (
  payment: bigint,
  remaining: bigint,
  rateBps: number | bigint,
  lateFeeDue: bigint,
): PaymentSplit => {
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const lateFee = min(payment, lateFeeDue);
  let rest = payment - lateFee;
  const interest = min(rest, interestForPeriod(remaining, rateBps));
  rest -= interest;
  const principal = min(rest, remaining);
  return { lateFee, interest, principal, unapplied: rest - principal };
};

export const finalInstallment = (remaining: bigint, rateBps: number | bigint): bigint =>
  toU64(remaining + interestForPeriod(remaining, rateBps));

/** [havuz, platform, yedek]; küsurat havuza. */
export const splitInterest = (
  interest: bigint,
  rateBps: number | bigint,
): [bigint, bigint, bigint] => {
  const rate = BigInt(rateBps);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const platform = rate === 0n ? 0n : min(interest, mulDiv(interest, PLATFORM_INTEREST_BPS, rate));
  const reserve =
    rate === 0n ? 0n : min(interest - platform, mulDiv(interest, RESERVE_INTEREST_BPS, rate));
  return [interest - platform - reserve, platform, reserve];
};

// ---- kredi boyutlandırma ----
export const originationFee = (principal: bigint): bigint =>
  toU64(mulDivUp(principal, ORIGINATION_FEE_BPS, BPS));
export const maxPrincipal = (value: bigint, maxLtvBps: number | bigint): bigint =>
  toU64(mulDiv(value, BigInt(maxLtvBps), BPS));
export const minDownPayment = (price: bigint, maxLtvBps: number | bigint): bigint =>
  toU64(mulDivUp(price, BPS - BigInt(maxLtvBps), BPS));
export const collateralAmount = (inst: bigint): bigint => toU64(inst * COLLATERAL_INSTALLMENTS);

// ---- NAV ve paylar (nav.rs) ----
export const seniorNav = (p: {
  idleCash: bigint;
  totalOutstanding: bigint;
  lossProvision: bigint;
  firstLossBalance: bigint;
  reserveBalance: bigint;
}): bigint => {
  const gross = p.idleCash + p.totalOutstanding;
  let shortfall = p.lossProvision - p.firstLossBalance - p.reserveBalance;
  if (shortfall < 0n) shortfall = 0n;
  return gross > shortfall ? gross - shortfall : 0n;
};

export const sharePrice = (nav: bigint, totalShares: bigint): bigint =>
  mulDiv(nav + VIRTUAL_ASSETS, SCALE, totalShares + VIRTUAL_SHARES);
export const sharesForDeposit = (netAssets: bigint, totalShares: bigint, nav: bigint): bigint =>
  toU64(mulDiv(netAssets, totalShares + VIRTUAL_SHARES, nav + VIRTUAL_ASSETS));
export const assetsForShares = (shares: bigint, totalShares: bigint, nav: bigint): bigint =>
  toU64(mulDiv(shares, nav + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES));
export const entryExitFee = (amount: bigint, feeBps: number | bigint): bigint =>
  toU64(mulDivUp(amount, BigInt(feeBps), BPS));

export const depositQuote = (
  amount: bigint,
  feeBps: number | bigint,
  totalShares: bigint,
  nav: bigint,
): { fee: bigint; shares: bigint } => {
  if (amount === 0n) throw new Error("ZeroAmount");
  const fee = entryExitFee(amount, feeBps);
  const net = amount - (fee < amount ? fee : amount);
  return { fee, shares: sharesForDeposit(net, totalShares, nav) };
};

export const withdrawQuote = (
  shares: bigint,
  feeBps: number | bigint,
  totalShares: bigint,
  nav: bigint,
): { gross: bigint; fee: bigint; net: bigint } => {
  if (shares === 0n) throw new Error("ZeroAmount");
  const gross = assetsForShares(shares, totalShares, nav);
  const f = entryExitFee(gross, feeBps);
  const fee = f < gross ? f : gross;
  return { gross, fee, net: gross - fee };
};
