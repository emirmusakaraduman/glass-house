"use client";

import { useId, useImperativeHandle, useRef, type Ref } from "react";
import { usd } from "@/lib/format";
import type { Absorbed } from "@/lib/stressTimeline";

// The loss order as four glass tanks side by side: collateral, first-loss vault, reserve, then
// the wider investors' tank. Capital is the cyan liquid; a loss drains it, and a red arc hops to
// the next tank once the loss has passed a layer. Names and amounts are HTML under the drawing,
// so they keep their size (12px and up) however wide the tanks are drawn.

export type LayerKey = keyof Absorbed;
export const LAYERS: LayerKey[] = ["collateral", "firstLoss", "reserve", "investors"];
export const LAYER_NAME: Record<LayerKey, string> = {
  collateral: "Borrowers' collateral",
  firstLoss: "First-loss vault",
  reserve: "Reserve fund",
  investors: "Investors",
};
const LABEL: Record<LayerKey, [string, string]> = {
  collateral: ["Borrower", "collateral"],
  firstLoss: ["First-loss", "vault"],
  reserve: ["Reserve", "fund"],
  investors: ["Investors", ""],
};

const TOP = 26;
const W = { collateral: 58, firstLoss: 58, reserve: 58, investors: 82 } as const;
const GAP = 10;
const VB = { w: W.collateral + W.firstLoss + W.reserve + W.investors + 3 * GAP, h: TOP + 142 };
const TANK: Record<LayerKey, { x: number; y: number; w: number; h: number }> = (() => {
  let x = 0;
  const out = {} as Record<LayerKey, { x: number; y: number; w: number; h: number }>;
  for (const k of LAYERS) {
    out[k] = { x, y: TOP, w: W[k], h: k === "investors" ? 140 : 114 };
    x += W[k] + GAP;
  }
  return out;
})();

function wavePath(w: number) {
  // Two wavelengths per tank width, drawn over 2w so a shift of w/2 loops seamlessly.
  const amp = 2.4;
  const half = w / 4;
  let d = `M ${-w} 0`;
  for (let x = -w; x < w; x += half * 2) d += ` q ${half / 2} ${-amp} ${half} 0 t ${half} 0`;
  return `${d} L ${w} 14 L ${-w} 14 Z`;
}

export interface TanksHandle {
  draw: (a: Absorbed) => void;
  /** Viewport point on the liquid surface of a tank (particle target). */
  surfaceOf: (k: LayerKey) => { x: number; y: number } | null;
}

export function LossTanks({ capacity, ref }: { capacity: Absorbed; ref?: Ref<TanksHandle> }) {
  const uid = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement | null>(null);
  const liquid = useRef<Partial<Record<LayerKey, SVGRectElement | null>>>({});
  const tint = useRef<Partial<Record<LayerKey, SVGRectElement | null>>>({});
  const wave = useRef<Partial<Record<LayerKey, SVGGElement | null>>>({});
  const amount = useRef<Partial<Record<LayerKey, HTMLSpanElement | null>>>({});
  const tankEl = useRef<Partial<Record<LayerKey, SVGGElement | null>>>({});
  const arc = useRef<(SVGPathElement | null)[]>([]);
  const level = useRef<Record<LayerKey, number>>({ collateral: 1, firstLoss: 1, reserve: 1, investors: 1 });
  const text = useRef<Partial<Record<LayerKey, string>>>({});

  useImperativeHandle(
    ref,
    () => ({
      draw(a) {
        for (const k of LAYERS) {
          const cap = capacity[k];
          const g = TANK[k];
          const lv = cap > 0 ? Math.max(0, Math.min(1, (cap - a[k]) / cap)) : 0;
          level.current[k] = lv;
          const top = g.y + (1 - lv) * g.h;
          const rect = liquid.current[k];
          for (const r of [rect, tint.current[k]]) {
            if (!r) continue;
            r.setAttribute("y", top.toFixed(2));
            r.setAttribute("height", (lv * g.h).toFixed(2));
          }
          const w = wave.current[k];
          if (w) {
            w.setAttribute("transform", `translate(${g.x + g.w / 2} ${(top - 1).toFixed(2)})`);
            w.style.opacity = lv > 0.01 ? "1" : "0";
          }
          tankEl.current[k]?.setAttribute("data-empty", cap > 0 && lv <= 0.0001 ? "1" : "0");
          // Compact amounts here; the counters and the tables below carry the exact figures.
          const hit = a[k] >= 0.5;
          const label = cap <= 0 ? "none" : hit ? `−${usd(a[k], { compact: true })}` : "$0";
          if (text.current[k] !== label) {
            text.current[k] = label;
            const el = amount.current[k];
            if (el) {
              el.textContent = label;
              el.dataset.hit = hit ? "1" : "0";
            }
          }
        }
        // An arc shows once loss has passed a layer: gap → first-loss, then reserve, then investors.
        const on = [a.firstLoss >= 0.5 || a.reserve >= 0.5 || a.investors >= 0.5, a.reserve >= 0.5 || a.investors >= 0.5, a.investors >= 0.5];
        on.forEach((v, i) => arc.current[i]?.setAttribute("data-on", v ? "1" : "0"));
      },
      surfaceOf(k) {
        const el = svg.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = r.width / VB.w;
        const g = TANK[k];
        const y = g.y + (1 - level.current[k]) * g.h;
        return { x: r.left + (g.x + g.w / 2) * s, y: r.top + Math.max(g.y + 4, y) * s };
      },
    }),
    [capacity],
  );

  const arcs = [0, 1, 2].map((i) => {
    const a = TANK[LAYERS[i]];
    const b = TANK[LAYERS[i + 1]];
    const x1 = a.x + a.w / 2;
    const x2 = b.x + b.w / 2;
    return `M ${x1} ${TOP - 2} Q ${(x1 + x2) / 2} ${-10} ${x2} ${TOP - 2}`;
  });

  return (
    <div>
      <svg ref={svg} viewBox={`0 0 ${VB.w} ${VB.h}`} className="block h-auto w-full overflow-visible" aria-hidden focusable="false">
        <defs>
          <linearGradient id={`${uid}-liq`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent-light)" stopOpacity="0.85" />
            <stop offset="1" stopColor="var(--color-accent-deep)" stopOpacity="0.85" />
          </linearGradient>
          {LAYERS.map((k) => {
            const g = TANK[k];
            return (
              <clipPath key={k} id={`${uid}-clip-${k}`}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={9} />
              </clipPath>
            );
          })}
        </defs>

        {arcs.map((d, i) => (
          <path
            key={i}
            ref={(el) => {
              arc.current[i] = el;
            }}
            d={d}
            className="gh-pipe"
            data-on="0"
            fill="none"
          />
        ))}

        {LAYERS.map((k) => {
          const g = TANK[k];
          const none = capacity[k] <= 0;
          return (
            <g
              key={k}
              ref={(el) => {
                tankEl.current[k] = el;
              }}
              className="gh-tank"
              data-none={none ? "1" : "0"}
              data-empty="0"
              data-senior={k === "investors" ? "1" : "0"}
            >
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={9} className="gh-tank-glass" />
              <g clipPath={`url(#${uid}-clip-${k})`}>
                <rect
                  ref={(el) => {
                    liquid.current[k] = el;
                  }}
                  x={g.x}
                  y={g.y}
                  width={g.w}
                  height={none ? 0 : g.h}
                  fill={`url(#${uid}-liq)`}
                />
                {/* Orange (stress) or red (collapse) tone over the remaining capital, set by the panel's data-fx. */}
                <rect
                  ref={(el) => {
                    tint.current[k] = el;
                  }}
                  x={g.x}
                  y={g.y}
                  width={g.w}
                  height={none ? 0 : g.h}
                  className="gh-tank-tint"
                />
                <g
                  ref={(el) => {
                    wave.current[k] = el;
                  }}
                  transform={`translate(${g.x + g.w / 2} ${g.y - 1})`}
                  style={{ opacity: none ? 0 : 1 }}
                >
                  <path d={wavePath(g.w)} className="gh-wave" style={{ ["--wave-w" as string]: `${g.w}px` }} />
                </g>
              </g>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={9} className="gh-tank-rim" />
            </g>
          );
        })}
      </svg>
      {/* Same column widths as the drawing: 58 / 58 / 58 / 82 with 10 between. */}
      <div className="gh-fx-solid mt-1 grid gap-x-[3.5%] rounded-md text-center text-[12px] leading-[1.2]" style={{ gridTemplateColumns: "58fr 58fr 58fr 82fr" }} aria-hidden>
        {LAYERS.map((k) => (
          <div key={k} className="min-w-0">
            <span className={k === "investors" ? "block font-bold text-ink" : "block font-semibold text-muted"}>{LABEL[k][0]}</span>
            <span className="block font-semibold text-muted">{LABEL[k][1] || " "}</span>
            <span
              ref={(el) => {
                amount.current[k] = el;
              }}
              data-hit="0"
              className="gh-tank-amount num block whitespace-nowrap font-bold"
            >
              {capacity[k] <= 0 ? "none" : "$0"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
