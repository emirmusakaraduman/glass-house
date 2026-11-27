"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SharePricePoint } from "@/lib/types";
import { CHART, TICK, TOOLTIP_STYLE } from "./chartTheme";

const DAY = 86_400_000;

/** Tick labels follow the span on screen: hours for a day, dates for weeks, months beyond that. */
function tickFormat(span: number) {
  if (span <= 2 * DAY) return (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (span <= 62 * DAY) return (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/**
 * Share price over time. The x axis is real time, so uneven gaps (monthly history, then
 * payments every demo minute) keep their proportions.
 */
export function SharePriceChart({ points, height = 260 }: { points: SharePricePoint[]; height?: number }) {
  const id = useId().replace(/:/g, "");
  const data = points.map((p) => ({ at: p.at, price: p.price }));
  const min = Math.min(...data.map((d) => d.price));
  const max = Math.max(...data.map((d) => d.price));
  const pad = Math.max(0.0005, (max - min) * 0.15);
  const span = data.length > 1 ? data[data.length - 1].at - data[0].at : DAY;
  const fmt = tickFormat(span);
  const first = data[0];
  const last = data[data.length - 1];
  const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="w-full" style={{ height }}>
      {first && last ? (
        <p className="sr-only">
          Share price chart: {first.price.toFixed(4)} USDC on {day(first.at)}, {last.price.toFixed(4)} USDC on {day(last.at)}, {data.length} data points.
        </p>
      ) : null}
      <div aria-hidden className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {/* userSpaceOnUse so a perfectly flat line still renders (a zero-height bounding box would hide it). */}
            <linearGradient id={`${id}-stroke`} gradientUnits="userSpaceOnUse" x1="0%" y1="0" x2="100%" y2="0">
              <stop offset="0" stopColor={CHART.home} />
              <stop offset="1" stopColor={CHART.homeLight} />
            </linearGradient>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={CHART.home} stopOpacity={0.42} />
              <stop offset="1" stopColor={CHART.home} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickLine={false}
            axisLine={{ stroke: CHART.axis }}
            tick={TICK}
            tickFormatter={fmt}
            minTickGap={40}
          />
          <YAxis domain={[min - pad, max + pad]} tickLine={false} axisLine={false} width={56} tick={TICK} tickFormatter={(v: number) => v.toFixed(3)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ stroke: CHART.homeLight, strokeOpacity: 0.4 }}
            labelFormatter={(t: unknown) => new Date(Number(t)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            formatter={(v: unknown) => [Number(v).toFixed(4), "Share price (USDC)"]}
          />
          <Area
            type="stepAfter"
            dataKey="price"
            stroke={`url(#${id}-stroke)`}
            strokeWidth={2.4}
            fill={`url(#${id}-fill)`}
            dot={false}
            activeDot={{ r: 4, fill: CHART.homeLight, stroke: "#0b1120", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
