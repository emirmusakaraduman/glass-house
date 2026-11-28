"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { loanStateAt, type LoanPlan, type LoanState } from "@/lib/stressTimeline";

// 100 small glass houses (or cars), one per loan. Colors come from CSS ([data-s] in globals.css),
// so a state change is one attribute write and a short CSS transition. Icons fill 24 of each
// 30-unit cell: drawn ~200px wide, that is a ~16px icon with a ~4px gap.

const CELL = 30;
const COLS = 10;

export interface CityGridHandle {
  draw: (t: number) => void;
  /** Center of a loan's icon in viewport pixels (particle start). */
  pointOf: (index: number) => { x: number; y: number } | null;
}

const HOUSE = "M3 13 L15 3 L27 13 L27 27 L3 27 Z";
const CAR = "M3 19 L7 10 L23 10 L27 19 L27 25.5 L3 25.5 Z";

export function CityGrid({ plan, kind, ref }: { plan: LoanPlan[]; kind: "house" | "vehicle"; ref?: Ref<CityGridHandle> }) {
  const cells = useRef<(SVGGElement | null)[]>([]);
  const shown = useRef<LoanState[]>(Array(100).fill("ok"));

  useImperativeHandle(
    ref,
    () => ({
      draw(t) {
        const next: LoanState[] = Array(100).fill("ok");
        for (const p of plan) next[p.index] = loanStateAt(p, t);
        for (let i = 0; i < 100; i++) {
          if (next[i] !== shown.current[i]) {
            shown.current[i] = next[i];
            cells.current[i]?.setAttribute("data-s", next[i]);
          }
        }
      },
      pointOf(index) {
        const el = cells.current[index];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
    }),
    [plan],
  );

  return (
    <div>
    <svg viewBox={`0 0 ${CELL * COLS} ${CELL * COLS}`} className="block h-auto w-full" aria-hidden focusable="false">
      {Array.from({ length: 100 }, (_, i) => {
        const x = (i % COLS) * CELL;
        const y = Math.floor(i / COLS) * CELL;
        return (
          <g
            key={i}
            ref={(el) => {
              cells.current[i] = el;
            }}
            className="gh-loan"
            data-s="ok"
            transform={`translate(${x} ${y})`}
          >
            <path className="gh-loan-body" d={kind === "house" ? HOUSE : CAR} strokeWidth={1.4} strokeLinejoin="round" />
            {kind === "vehicle" ? (
              <g className="gh-loan-wheels">
                <circle cx={9} cy={25.5} r={3} />
                <circle cx={21} cy={25.5} r={3} />
              </g>
            ) : null}
            <path className="gh-loan-warn" d="M23.5 0.5 L29.5 10.5 L17.5 10.5 Z" />
            {/* Sold: a corner tag instead of text (no text under 12px); the legend names it. */}
            <path className="gh-loan-sold" d="M17 3 L29.5 3 L29.5 15.5 Z" />
          </g>
        );
      })}
    </svg>
      <ul className="mt-1.5 flex justify-between gap-x-1.5 whitespace-nowrap text-[12px] leading-none text-muted" aria-hidden>
        <li className="inline-flex items-center gap-[3px]"><span className="gh-key gh-key-ok" />Paying</li>
        <li className="inline-flex items-center gap-[3px]"><span className="gh-key gh-key-late" />Late</li>
        <li className="inline-flex items-center gap-[3px]"><span className="gh-key gh-key-bad" />Default</li>
        <li className="inline-flex items-center gap-[3px]"><span className="gh-key gh-key-sold" />Sold</li>
      </ul>
    </div>
  );
}
