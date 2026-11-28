"use client";

import { useId } from "react";
import { cx } from "../ui";

// The GH emblem: a house outline with a chimney; inside it a joined G and H. The G's left and
// bottom strokes are the house's wall, the H's right leg is its right wall. Traced from
// public/brand/glasshouse-mark.png (coordinates are that PNG's pixels, so the two overlay).
// Brand colors are fixed here on purpose: the logo is never recolored (public/brand/README.md).

/** House, chimney and G in one outline (500×330 space, see the PNG). */
const HOUSE_G =
  "M50 300 L32 282 L32 158 L38 148 L255 22 L372 87.3 L372 57 L415 57 L415 111.3 L470 142 L470 172 L458 180 L255 67 " +
  "L113.9 147 L165 122 L235 122 L226 160 L150 160 L100 180 L77 186 L75 187 L75 258 L190 258 L190 228 L136 228 " +
  "L128 214 L136 200 L237 200 L237 300 Z";
/** The H: left leg, crossbar and right leg (the house's right wall). */
const H = "M257 113 L265 105 L300 105 L300 183 L400 183 L400 176 L446 176 L458 184 L458 290 L448 300 L400 300 L400 225 L300 225 L300 300 L257 300 Z";
const GLASS_PATH = `${HOUSE_G} ${H}`;
const GLASS_BOX = { x: 28, y: 18, w: 446, h: 286 };

/** Small-size cut on a 32×22 grid: thicker strokes, no inner detail, G and H still legible at 16 px. */
const SOLID_PATH =
  "M0 10 L16 0 L23 4.4 L23 1 L26 1 L26 6.25 L32 10 L32 22 L28 22 L28 17 L20 17 L20 22 L16.5 22 L16.5 4.2 L16 3.9 " +
  "L3.5 11.7 L3.5 18.5 L11 18.5 L11 15.5 L8 15.5 L8 12.5 L14.5 12.5 L14.5 22 L0 22 Z M20 13.5 L28 13.5 L28 11.2 L20 6.2 Z";
const SOLID_BOX = { w: 32, h: 22 };

export const BRAND_CYAN = "#00D2FF";
const BRAND_CYAN_LIGHT = "#7BE8FF";
const BRAND_HIGHLIGHT = "#E0F7FF";

export type LogoMarkVariant = "glass" | "solid";

/** Width over height for each variant, for callers that size by height. */
export const MARK_RATIO: Record<LogoMarkVariant, number> = {
  glass: GLASS_BOX.w / GLASS_BOX.h,
  solid: SOLID_BOX.w / SOLID_BOX.h,
};

/**
 * The emblem alone. `size` is the rendered width in px. Variant defaults by size:
 * "solid" at 24 px and below (one color, thick strokes), "glass" above (gradient, inner light, soft glow).
 * Decorative by default; pass `title` when the mark is the only thing naming GlassHouse.
 */
export function LogoMark({ size = 32, variant, title, className }: { size?: number; variant?: LogoMarkVariant; title?: string; className?: string }) {
  const id = useId();
  const v: LogoMarkVariant = variant ?? (size <= 24 ? "solid" : "glass");
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const };

  // The solid cut: one color, #00D2FF on dark and #0E7490 on light (--logo-solid-color in globals.css).
  const solid = (style?: React.CSSProperties, label = a11y) => (
    <svg viewBox={`0 0 ${SOLID_BOX.w} ${SOLID_BOX.h}`} width={size} height={size / MARK_RATIO.solid} className={cx("shrink-0", className)} style={style} {...label}>
      <path d={SOLID_PATH} fill="var(--logo-solid-color)" fillRule="evenodd" />
    </svg>
  );
  if (v === "solid") return solid();

  const grad = `${id}-g`;
  const clip = `${id}-c`;
  // Light backgrounds get the solid cut instead (glow only reads on dark); CSS variables switch them.
  return (
    <>
    {solid({ display: "var(--logo-solid)" }, { "aria-hidden": true as const })}
    <svg
      style={{ display: "var(--logo-glass)" }}
      viewBox={`${GLASS_BOX.x} ${GLASS_BOX.y} ${GLASS_BOX.w} ${GLASS_BOX.h}`}
      width={size}
      height={size / MARK_RATIO.glass}
      className={cx("shrink-0 overflow-visible drop-shadow-[0_0_6px_rgb(0_210_255/0.35)]", className)}
      {...a11y}
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="300" x2="0" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={BRAND_CYAN} />
          <stop offset="1" stopColor={BRAND_CYAN_LIGHT} />
        </linearGradient>
        <clipPath id={clip}>
          <path d={GLASS_PATH} />
        </clipPath>
      </defs>
      <path d={GLASS_PATH} fill={`url(#${grad})`} fillOpacity={0.92} />
      {/* Thin inner light: the outline stroked, clipped to the inside so only its inner half shows. */}
      <path d={GLASS_PATH} clipPath={`url(#${clip})`} fill="none" stroke={BRAND_HIGHLIGHT} strokeOpacity={0.75} strokeWidth={7} strokeLinejoin="bevel" />
    </svg>
    </>
  );
}
