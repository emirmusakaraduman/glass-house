"use client";

import { useId, useImperativeHandle, useRef, type Ref } from "react";
import { usd } from "@/lib/format";
import type { Absorbed } from "@/lib/stressTimeline";

// The loss order as four glass tanks on a staircase. Capital is the cyan liquid; a loss drains
// it, and once a tank can't take more a red stream pours into the next one down. Investors'
// tank is the big one at the bottom.

export type LayerKey = keyof Absorbed;
export const LAYERS: LayerKey[] = ["collateral", "firstLoss", "reserve", "investors"];
export const LAYER_NAME: Record<LayerKey, string> = {
  collateral: "Borrowers' collateral",
  firstLoss: "First-loss vault",
  reserve: "Reserve fund",
  investors: "Investors",
};
const LABEL: Record<LayerKey, [string, string]> = {
  collateral: ["Borrowers'", "collateral"],
  firstLoss: ["First-loss", "vault"],
  reserve: ["Reserve", "fund"],
  investors: ["Investors", ""],
};

const VB = { w: 420, h: 330 };
const TANK: Record<LayerKey, { x: number; y: number; w: number; h: number }> = {
  collateral: { x: 6, y: 16, w: 72, h: 80 },
  firstLoss: { x: 104, y: 62, w: 72, h: 92 },
  reserve: { x: 202, y: 120, w: 72, h: 72 },
  investors: { x: 300, y: 118, w: 114, h: 160 },
};

function wavePath(w: number) {
  // Two wavelengths per tank width, drawn over 2w so a shift of w loops seamlessly.
  const amp = 2.6;
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
  const wave = useRef<Partial<Record<LayerKey, SVGGElement | null>>>({});
  const amount = useRef<Partial<Record<LayerKey, SVGTextElement | null>>>({});
  const tankEl = useRef<Partial<Record<LayerKey, SVGGElement | null>>>({});
  const pipe = useRef<(SVGPathElement | null)[]>([]);
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
          if (rect) {
            rect.setAttribute("y", top.toFixed(2));
            rect.setAttribute("height", (lv * g.h).toFixed(2));
          }
          const w = wave.current[k];
          if (w) {
            w.setAttribute("transform", `translate(${g.x + g.w / 2} ${(top - 1).toFixed(2)})`);
            w.style.opacity = lv > 0.01 ? "1" : "0";
          }
          tankEl.current[k]?.setAttribute("data-empty", cap > 0 && lv <= 0.0001 ? "1" : "0");
          const label = cap <= 0 ? "none" : a[k] > 0 ? `−${usd(a[k])}` : "$0";
          if (text.current[k] !== label) {
            text.current[k] = label;
            const el = amount.current[k];
            if (el) {
              el.textContent = label;
              el.setAttribute("data-hit", a[k] > 0 ? "1" : "0");
            }
          }
        }
        // A stream shows once loss has passed a layer: gap → first-loss, then reserve, then investors.
        const on = [a.firstLoss > 0 || a.reserve > 0 || a.investors > 0, a.reserve > 0 || a.investors > 0, a.investors > 0];
        on.forEach((v, i) => pipe.current[i]?.setAttribute("data-on", v ? "1" : "0"));
      },
      surfaceOf(k) {
        const el = svg.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = r.width / VB.w;
        const g = TANK[k];
        const y = g.y + (1 - level.current[k]) * g.h;
        return { x: r.left + (g.x + g.w / 2) * s, y: r.top + Math.max(g.y + 6, y) * s };
      },
    }),
    [capacity],
  );

  const pipes = [0, 1, 2].map((i) => {
    const a = TANK[LAYERS[i]];
    const b = TANK[LAYERS[i + 1]];
    const sx = a.x + a.w - 12;
    const sy = a.y + a.h;
    const tx = b.x + 20;
    const ty = b.y + 4;
    return `M ${sx} ${sy} C ${sx} ${sy + 26} ${tx} ${ty - 34} ${tx} ${ty}`;
  });

  return (
    <svg ref={svg} viewBox={`0 0 ${VB.w} ${VB.h}`} className="block h-auto w-full" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${uid}-liq`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent-light)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--color-accent-deep)" stopOpacity="0.85" />
        </linearGradient>
        {LAYERS.map((k) => {
          const g = TANK[k];
          return (
            <clipPath key={k} id={`${uid}-clip-${k}`}>
              <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
            </clipPath>
          );
        })}
      </defs>

      {pipes.map((d, i) => (
        <path
          key={i}
          ref={(el) => {
            pipe.current[i] = el;
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
        const [l1, l2] = LABEL[k];
        const lx = g.x + g.w / 2;
        const ly = g.y + g.h;
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
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} className="gh-tank-glass" />
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
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} className="gh-tank-rim" />
            <text x={lx} y={ly + 17} textAnchor="middle" className="gh-tank-name">
              {l1}
            </text>
            {l2 ? (
              <text x={lx} y={ly + 32} textAnchor="middle" className="gh-tank-name">
                {l2}
              </text>
            ) : null}
            <text
              ref={(el) => {
                amount.current[k] = el;
              }}
              x={lx}
              y={ly + (l2 ? 50 : 36)}
              textAnchor="middle"
              className="gh-tank-amount num"
              data-hit="0"
            >
              {none ? "none" : "$0"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
