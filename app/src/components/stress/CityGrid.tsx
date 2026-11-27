"use client";

import { useImperativeHandle, useRef, type Ref } from "react";
import { loanStateAt, type LoanPlan, type LoanState } from "@/lib/stressTimeline";

// 100 small glass houses (or cars), one per loan. Colors come from CSS ([data-s] in globals.css),
// so a state change is one attribute write and a short CSS transition.

const CELL = 30;
const COLS = 10;

export interface CityGridHandle {
  draw: (t: number) => void;
  /** Center of a loan's icon in viewport pixels (particle start). */
  pointOf: (index: number) => { x: number; y: number } | null;
}

const HOUSE = "M5 13.5 L15 5 L25 13.5 L25 25 L5 25 Z";
const CAR = "M3 20 L6.5 12.5 L23.5 12.5 L27 20 L27 24 L3 24 Z";

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
                <circle cx={9} cy={24} r={2.6} />
                <circle cx={21} cy={24} r={2.6} />
              </g>
            ) : null}
            <path className="gh-loan-warn" d="M23 2.5 L28.5 11.5 L17.5 11.5 Z" />
            <g className="gh-loan-sold">
              <rect x={2} y={15} width={26} height={9} rx={2} />
              <text x={15} y={22} textAnchor="middle">
                SOLD
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}
