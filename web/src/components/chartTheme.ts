import type { CSSProperties } from "react";

// Recharts styling shared by every chart: home pool cyan, car pool indigo, dark glass tooltip.
// Gold is never used in charts.

export const CHART = {
  /** Home pool series (and the main series of single-series charts). */
  home: "#00d2ff",
  homeLight: "#7de6ff",
  /** Car pool series. */
  car: "#818cf8",
  grid: "rgb(255 255 255 / 0.06)",
  axis: "rgb(255 255 255 / 0.12)",
  /** Same as --color-muted over the page (6.6:1). */
  tick: "#919aa7",
  cursor: "rgb(255 255 255 / 0.04)",
} as const;

export const TICK = { fill: CHART.tick, fontSize: 12 } as const;

export const TOOLTIP_STYLE: { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties } = {
  contentStyle: {
    background: "rgb(19 28 49 / 0.92)",
    border: "1px solid rgb(255 255 255 / 0.12)",
    borderRadius: 12,
    boxShadow: "0 16px 40px -12px rgb(0 0 0 / 0.7)",
    backdropFilter: "blur(16px)",
    fontFamily: "var(--font-jakarta)",
    color: "#f1f5f9",
  },
  labelStyle: { color: "#919aa7", marginBottom: 4 },
  itemStyle: { color: "#f1f5f9" },
};
