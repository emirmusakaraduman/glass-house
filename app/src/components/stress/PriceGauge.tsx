"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { usd } from "@/lib/format";
import { TIMELINE_MONTHS, priceIndexAt } from "@/lib/stressTimeline";

// A thin price strip: label and "$100,000 → $70,000" on the left, the index drawn as the clock
// runs on the right. The chart stretches to the width; strokes keep their thickness.

const W = 240;
const H = 40;
const MAX_DROP = 0.6;
const px = (t: number) => 3 + (t / TIMELINE_MONTHS) * (W - 6);
const py = (idx: number) => 4 + ((1 - idx) / MAX_DROP) * (H - 8);

function pathTo(drop: number, t: number) {
  let d = `M ${px(0)} ${py(1)}`;
  for (let m = 0.25; m < t; m += 0.25) d += ` L ${px(m).toFixed(1)} ${py(priceIndexAt(drop, m)).toFixed(1)}`;
  return `${d} L ${px(t).toFixed(1)} ${py(priceIndexAt(drop, t)).toFixed(1)}`;
}
const dotAt = (t: number, idx: number) => `M ${px(t).toFixed(1)} ${py(idx).toFixed(1)} l 0.01 0`;

export interface PriceHandle {
  draw: (t: number, drop: number, shownIndex: number) => void;
}

export function PriceGauge({ price, drop, label, ref }: { price: number; drop: number; label: string; ref?: Ref<PriceHandle> }) {
  const line = useRef<SVGPathElement | null>(null);
  const dot = useRef<SVGPathElement | null>(null);
  const now = useRef<HTMLSpanElement | null>(null);
  const last = useRef("");

  useImperativeHandle(
    ref,
    () => ({
      draw(t, d, idx) {
        line.current?.setAttribute("d", pathTo(d, t));
        dot.current?.setAttribute("d", dotAt(t, idx));
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
    <div className="flex h-10 items-center gap-3 rounded-xl border border-haze/[0.07] bg-haze/[0.025] px-3">
      <div className="shrink-0 leading-tight">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="num block text-[13px] font-semibold">
          {usd(price)} <span className="text-muted">→</span>{" "}
          <span ref={now} className="text-bad-fg">
            {usd(price)}
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-8 min-w-0 flex-1" aria-hidden focusable="false">
        <line x1={px(0)} x2={px(TIMELINE_MONTHS)} y1={py(1)} y2={py(1)} className="gh-price-base" vectorEffect="non-scaling-stroke" />
        <path d={pathTo(drop, TIMELINE_MONTHS)} className="gh-price-ghost" fill="none" vectorEffect="non-scaling-stroke" />
        <path ref={line} d={`M ${px(0)} ${py(1)}`} className="gh-price-line" fill="none" vectorEffect="non-scaling-stroke" />
        <path ref={dot} d={dotAt(0, 1)} className="gh-price-dot" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
