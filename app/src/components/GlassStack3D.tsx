"use client";

import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { usd } from "@/lib/format";
import type { LossLayer } from "./LossStack";
import { cx } from "./ui";

// The loss order as three glass slabs, stacked: first-loss vault on top, reserve fund in the
// middle, investors (thickest) at the bottom. A loss enters from the top and works down.
// Each slab is filled with what's left; the part eaten by provisions is red hatch.
// CSS 3D only (perspective + rotateX/rotateY). The 3D scene is aria-hidden; the labels next to
// it carry the same numbers as text.

const W = 210; // slab width (px)
const D = 150; // slab depth
const GAP = 26;

function Face({ style, used, className }: { style: CSSProperties; used: number; className?: string }) {
  return (
    <div
      className={cx(
        "absolute left-0 top-0 overflow-hidden border border-accent-light/60 bg-[linear-gradient(135deg,rgb(125_230_255/0.16),rgb(0_210_255/0.06))] shadow-[inset_0_0_18px_rgb(0_210_255/0.35),0_0_16px_rgb(0_210_255/0.35)]",
        className,
      )}
      style={style}
    >
      {/* what's left: cyan glass fill */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_210_255/0.38),rgb(125_230_255/0.22))]" />
      {/* what provisions have eaten, from the side the loss enters */}
      {used > 0 ? <div className="loss-hatch absolute inset-y-0 left-0" style={{ width: `${Math.min(1, used) * 100}%` }} /> : null}
      <div className="absolute inset-x-0 top-0 h-px bg-white/50" />
    </div>
  );
}

function Slab({ h, y, used }: { h: number; y: number; used: number }) {
  // A box W×h×D centered on the stack's axis, its top at `y`.
  const box: CSSProperties = { position: "absolute", left: "50%", top: y, width: W, height: h, marginLeft: -W / 2, transformStyle: "preserve-3d" };
  return (
    <div style={box}>
      <Face used={used} style={{ width: W, height: h, transform: `translateZ(${D / 2}px)` }} />
      <Face used={used} style={{ width: D, height: h, left: (W - D) / 2, transform: `rotateY(90deg) translateZ(${W / 2}px)` }} className="brightness-90" />
      <Face used={used} style={{ width: D, height: h, left: (W - D) / 2, transform: `rotateY(-90deg) translateZ(${W / 2}px)` }} className="brightness-75" />
      <Face used={used} style={{ width: W, height: D, top: (h - D) / 2, transform: `rotateX(90deg) translateZ(${h / 2}px)` }} className="brightness-125" />
    </div>
  );
}

export function GlassStack3D({ layers, className }: { layers: LossLayer[]; className?: string }) {
  // layers come in loss order (first-loss, reserve, investors): top to bottom.
  const heights = layers.map((l) => (l.senior ? 58 : 26));
  const tops = heights.reduce<number[]>((acc, h, i) => [...acc, i === 0 ? 0 : acc[i - 1] + heights[i - 1] + GAP], []);
  const stackH = tops[tops.length - 1] + heights[heights.length - 1];

  const wrap = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className={cx("flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-center", className)}>
      <div
        ref={wrap}
        aria-hidden
        className="relative shrink-0"
        style={{ width: 280, height: stackH + 150, perspective: 900 }}
        onPointerMove={(e) => {
          if (still || !wrap.current) return;
          const r = wrap.current.getBoundingClientRect();
          setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -8, y: ((e.clientX - r.left) / r.width - 0.5) * 12 });
        }}
        onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      >
        {/* soft glow under the stack */}
        <div className="absolute inset-x-6 bottom-4 h-16 rounded-full bg-accent/40 blur-2xl" />
        <div
          className="absolute inset-0 motion-safe:transition-transform motion-safe:duration-300"
          style={{ transformStyle: "preserve-3d", transform: still ? undefined : `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)` }}
        >
          <div className="gh-sway absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
            <div className="absolute inset-x-0" style={{ top: 80, height: stackH, transformStyle: "preserve-3d", transform: "rotateX(-24deg) rotateY(-34deg)" }}>
              {layers.map((l, i) => (
                <Slab key={l.name} h={heights[i]} y={tops[i]} used={l.capacity > 0 ? l.used / l.capacity : l.used > 0 ? 1 : 0} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-[260px]">
        <p className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-bad-fg">
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />A loss enters at the top
        </p>
        <ol className="space-y-3">
          {layers.map((l, i) => {
            const left = Math.max(0, l.capacity - l.used);
            return (
              <li key={l.name} className="flex gap-3">
                <span className="num mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent-light/30 bg-accent/15 text-[12.5px] font-bold text-steel">{i + 1}</span>
                <div className="min-w-0">
                  <div className={cx("font-semibold", l.senior && "text-[15px]")}>{l.name}</div>
                  <div className="num text-[13px] text-muted">
                    {usd(left)} left
                    {l.used > 0 ? <span className="font-semibold text-bad-fg">, {usd(l.used)} absorbed</span> : null}
                  </div>
                  <div className="text-[12.5px] text-muted">{l.owner}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
