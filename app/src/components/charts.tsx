"use client";

import { Line, LineChart, Pie, PieChart, Tooltip, YAxis } from "recharts";
import { usd } from "@/lib/format";
import { CHART, TOOLTIP_STYLE } from "./chartTheme";

/** Axis-free line for KpiCard's slot (Recharts). Draws only the series it gets. */
export function MiniSparkline({ values, tone = "home", width = 84, height = 40, label }: { values: number[]; tone?: "home" | "car"; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div role="img" aria-label={label} title={label} style={{ width, height }}>
      <LineChart width={width} height={height} data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          type="monotone"
          dataKey="v"
          stroke={tone === "car" ? CHART.car : CHART.home}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          style={{ filter: `drop-shadow(0 0 4px ${tone === "car" ? "rgb(129 140 248 / 0.6)" : "rgb(0 210 255 / 0.6)"})` }}
        />
      </LineChart>
    </div>
  );
}

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

/** Ring chart with the total in the middle. Slices carry their own color. */
/** `centerValue` replaces the USD total in the middle (e.g. "22 / 240"). */
export function Donut({ slices, centerLabel, centerValue, size = 200, tooltip = true }: { slices: DonutSlice[]; centerLabel: string; centerValue?: string; size?: number; tooltip?: boolean }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = slices.map((s) => ({ name: s.name, value: s.value, fill: s.color }));
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <p className="sr-only">
        {centerLabel}: {centerValue ?? usd(total)}. {slices.map((s) => `${s.name}: ${centerValue ? s.value : usd(s.value)}`).join(", ")}.
      </p>
      <div aria-hidden>
      <PieChart width={size} height={size}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={size * 0.34}
          outerRadius={size * 0.48}
          paddingAngle={total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 3 : 0}
          cornerRadius={6}
          stroke="none"
          startAngle={90}
          endAngle={-270}
          isAnimationActive={false}
        />
        {tooltip ? <Tooltip {...TOOLTIP_STYLE} formatter={(v: unknown, n: unknown) => [usd(Number(v)), String(n)]} /> : null}
      </PieChart>
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="num text-xl font-extrabold tracking-tight">{centerValue ?? usd(total, { compact: true })}</span>
        <span className="text-[12.5px] text-muted">{centerLabel}</span>
      </div>
    </div>
  );
}
