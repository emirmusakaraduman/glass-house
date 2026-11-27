"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { usd } from "@/lib/format";
import { TIMELINE_MONTHS, priceIndexAt } from "@/lib/stressTimeline";

// Price index drawn as the clock runs, with a "$100,000 → $70,000" counter.

const W = 240;
const H = 64;
const MAX_DROP = 0.6;
const px = (t: number) => 4 + (t / TIMELINE_MONTHS) * (W - 8);
const py = (idx: number) => 6 + ((1 - idx) / MAX_DROP) * (H - 12);

function pathTo(drop: number, t: number) {
  let d = `M ${px(0)} ${py(1)}`;
  for (let m = 0.25; m < t; m += 0.25) d += ` L ${px(m).toFixed(1)} ${py(priceIndexAt(drop, m)).toFixed(1)}`;
  return `${d} L ${px(t).toFixed(1)} ${py(priceIndexAt(drop, t)).toFixed(1)}`;
}

export interface PriceHandle {
  draw: (t: number, drop: number, shownIndex: number) => void;
}

export function PriceGauge({ price, drop, label, ref }: { price: number; drop: number; label: string; ref?: Ref<PriceHandle> }) {
  const line = useRef<SVGPathElement | null>(null);
  const dot = useRef<SVGCircleElement | null>(null);
  const now = useRef<HTMLSpanElement | null>(null);
  const last = useRef("");

  useImperativeHandle(
    ref,
    () => ({
      draw(t, d, idx) {
        line.current?.setAttribute("d", pathTo(d, t));
        dot.current?.setAttribute("cx", px(t).toFixed(1));
        dot.current?.setAttribute("cy", py(idx).toFixed(1));
        const txt = usd(Math.round((price * idx) / 100) * 100);
        if (txt !== last.current && now.current) {
          last.current = txt;
          now.current.textContent = txt;
        }
      },
    }),
    [price],
  );

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold">
          {usd(price)} <span className="text-muted">→</span>{" "}
          <span ref={now} className="text-bad-fg">
            {usd(price)}
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 block h-auto w-full" aria-hidden focusable="false">
        <line x1={px(0)} x2={px(TIMELINE_MONTHS)} y1={py(1)} y2={py(1)} className="gh-price-base" />
        <path d={pathTo(drop, TIMELINE_MONTHS)} className="gh-price-ghost" fill="none" />
        <path ref={line} d={`M ${px(0)} ${py(1)}`} className="gh-price-line" fill="none" />
        <circle ref={dot} cx={px(0)} cy={py(1)} r={3.2} className="gh-price-dot" />
      </svg>
    </div>
  );
}
