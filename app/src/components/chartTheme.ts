import type { CSSProperties } from "react";

// Recharts styling shared by every chart: home pool cyan, car pool indigo, glass tooltip.
// Colors are CSS variables (globals.css), so every chart follows the theme. Gold is never used in charts.

export const CHART = {
  /** Home pool series (and the main series of single-series charts). */
  home: "var(--color-chart-home)",
  homeLight: "var(--color-accent-light)",
  /** Car pool series. */
  car: "var(--color-chart-car)",
  grid: "var(--color-chart-grid)",
  axis: "rgb(var(--haze-rgb) / 0.12)",
  /** Same as --color-muted over the page. */
  tick: "var(--color-muted)",
  cursor: "rgb(var(--haze-rgb) / 0.04)",
} as const;

export const TICK = { fill: CHART.tick, fontSize: 12 } as const;

export const TOOLTIP_STYLE: { contentStyle: CSSProperties; labelStyle: CSSProperties; itemStyle: CSSProperties } = {
  contentStyle: {
    background: "rgb(var(--glass-rgb) / 0.95)",
    border: "1px solid var(--color-line)",
    borderRadius: 12,
    boxShadow: "0 16px 40px -12px rgb(0 0 0 / 0.35)",
    backdropFilter: "blur(16px)",
    fontFamily: "var(--font-jakarta)",
    color: "var(--color-ink)",
  },
  labelStyle: { color: "var(--color-muted)", marginBottom: 4 },
  itemStyle: { color: "var(--color-ink)" },
};
