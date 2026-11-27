import type { PoolId, PoolParams } from "./types";

// Pool parameters from the v4 design doc ("İki ürün, iki izole havuz").
// Both pools come from the same program via create_pool; only these values differ.

export const HOUSE_POOL: PoolParams = {
  id: "house",
  assetType: "house",
  name: "Home pool",
  maxLtv: 0.7,
  annualRate: 0.07,
  poolRate: 0.06,
  platformRate: 0.005,
  reserveRate: 0.005,
  termMonths: 240,
  maxDti: 0.35,
  originationFee: 0.01,
  collateralInstallments: 3,
  recoveryCoeff: 0.63, // 0.7 × 0.9: 30% price drop, 10% sale cost
  provisionRates: [0, 0.05, 0.15, 0.15],
  liquidityBuffer: 0.1,
  brakeDelinquency: 0.1,
  brakeReserveMin: 0.01,
  lateFee: 0.02,
  firstLossTarget: 0.05,
  valueBand: 50_000,
  periodSeconds: 60,
  graceSeconds: 10,
  targetYield: 0.06,
};

export const VEHICLE_POOL: PoolParams = {
  id: "vehicle",
  assetType: "vehicle",
  name: "Car pool",
  maxLtv: 0.6,
  annualRate: 0.09,
  poolRate: 0.08,
  platformRate: 0.005,
  reserveRate: 0.005,
  termMonths: 60,
  maxDti: 0.35,
  originationFee: 0.01,
  collateralInstallments: 3,
  recoveryCoeff: 0.54, // 0.6 × 0.9: 40% value loss, 10% sale cost
  provisionRates: [0, 0.05, 0.15, 0.15],
  liquidityBuffer: 0.1,
  brakeDelinquency: 0.1,
  brakeReserveMin: 0.01,
  lateFee: 0.02,
  firstLossTarget: 0.05,
  valueBand: 5_000,
  periodSeconds: 60,
  graceSeconds: 10,
  targetYield: 0.08,
};

export const POOLS: Record<PoolId, PoolParams> = {
  house: HOUSE_POOL,
  vehicle: VEHICLE_POOL,
};

export const POOL_IDS: PoolId[] = ["house", "vehicle"];

export function isPoolId(v: unknown): v is PoolId {
  return v === "house" || v === "vehicle";
}

/** Vehicles older than this are not financed (underwriter policy, checked off-chain). */
export const MAX_VEHICLE_AGE_YEARS = 8;
