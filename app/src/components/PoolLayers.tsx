"use client";

import type { PoolMetrics, PoolState } from "@/lib/types";
import { LossStack, type LossLayer } from "./LossStack";

/** Pool-level loss order: first-loss vault → reserve → investors. Per-loan layers sit before these. */
export function poolLayers(pool: PoolState, m: PoolMetrics): LossLayer[] {
  const fromFirstLoss = Math.min(pool.lossProvision, pool.firstLossVault);
  const fromReserve = Math.min(Math.max(0, pool.lossProvision - pool.firstLossVault), pool.reserve);
  return [
    { name: "First-loss vault", owner: "platform's own capital", capacity: pool.firstLossVault, used: fromFirstLoss },
    { name: "Reserve fund", owner: "fed by fees and interest", capacity: pool.reserve, used: fromReserve },
    { name: "Investors", owner: "senior shares", capacity: m.seniorNav + m.seniorImpairment, used: m.seniorImpairment, senior: true },
  ];
}

export function PoolLossStack({ pool, metrics }: { pool: PoolState; metrics: PoolMetrics }) {
  const asset = pool.params.assetType === "house" ? "home" : "car";
  return (
    <LossStack
      layers={poolLayers(pool, metrics)}
      caption={`Before a loss reaches the pool it goes through the borrower's down payment, their collateral and the sale of the ${asset}. Hatched = provisions held against late or defaulted loans.`}
    />
  );
}
