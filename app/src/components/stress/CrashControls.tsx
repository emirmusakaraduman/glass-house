"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Segmented, cx } from "@/components/ui";
import { TIMELINE_MONTHS } from "@/lib/stressTimeline";
import { SPEEDS, type Speed, type TimelineEngine } from "./useTimeline";

/** The page's one gold button: Run the crash / Pause / Replay. */
export function RunButton({ engine, className }: { engine: TimelineEngine; className?: string }) {
  const Icon = engine.playing ? Pause : engine.ended ? RotateCcw : Play;
  const label = engine.playing ? "Pause" : engine.ended ? "Replay" : engine.month > 0 ? "Resume the crash" : "Run the crash";
  return (
    <Button onClick={engine.toggle} className={cx("h-12 min-w-[214px] px-6 text-[16px]", className)} aria-keyshortcuts="Space">
      <Icon className="h-5 w-5" aria-hidden />
      {label}
    </Button>
  );
}

const pctOf = (m: number) => `${(m / TIMELINE_MONTHS) * 100}%`;

/** Months 0–15 with the three phases; drag, or step a month at a time with the arrow keys. */
export function TimelineBar({ engine, asset }: { engine: TimelineEngine; asset: "home" | "car" }) {
  const input = useRef<HTMLInputElement | null>(null);
  const { subscribe, seek, getT } = engine;

  useEffect(
    () =>
      subscribe(({ t }) => {
        const el = input.current;
        if (!el) return;
        if (document.activeElement !== el || engine.playing) el.value = String(t);
        el.style.setProperty("--fill", pctOf(t));
      }),
    // engine.playing only decides whether to overwrite a value the user is dragging.
    [subscribe, engine.playing],
  );

  const phases = [
    { label: "Prices fall", from: 0, to: 6, row: 0 },
    { label: `${asset === "home" ? "Homes" : "Cars"} sold`, from: 4, to: 15, row: 1 },
    { label: "Payments missed", from: 1, to: 3, row: 1 },
  ];

  return (
    <div className="pane p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-semibold">
          Timeline <span className="font-normal text-muted">· month {engine.month} of {TIMELINE_MONTHS}</span>
        </span>
        <Segmented<`${Speed}`>
          label="Speed"
          value={`${engine.speed}`}
          onChange={(v) => engine.setSpeed(Number(v) as Speed)}
          options={SPEEDS.map((s) => ({ value: `${s}` as `${Speed}`, label: `${s}x` }))}
        />
      </div>
      <div className="relative mt-3 h-[44px]" aria-hidden>
        {phases.map((p) => (
          <div
            key={p.label}
            className={cx("absolute flex h-[18px] items-center overflow-hidden rounded-full border px-2 text-[11.5px] font-semibold", p.row === 0 ? "top-0" : "top-[22px]", p.label === "Payments missed" ? "border-warn/35 bg-warn/10 text-warn" : p.label === "Prices fall" ? "border-accent/30 bg-accent/10 text-steel" : "border-bad/35 bg-bad/10 text-bad-fg")}
            style={{ left: pctOf(p.from), width: `calc(${pctOf(p.to - p.from)} - 4px)` }}
          >
            <span className="truncate">{p.label}</span>
          </div>
        ))}
      </div>
      <input
        ref={input}
        type="range"
        min={0}
        max={TIMELINE_MONTHS}
        step={0.01}
        defaultValue={0}
        className="gh-range mt-1"
        aria-label="Month of the crash"
        aria-valuetext={`Month ${engine.month} of ${TIMELINE_MONTHS}`}
        onChange={(e) => seek(Number(e.target.value))}
        onPointerDown={() => engine.playing && engine.pause()}
        onKeyDown={(e) => {
          const t = getT();
          let to: number | null = null;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") to = Math.floor(t + 1e-9) + 1;
          else if (e.key === "ArrowLeft" || e.key === "ArrowDown") to = Math.ceil(t - 1e-9) - 1;
          else if (e.key === "Home") to = 0;
          else if (e.key === "End") to = TIMELINE_MONTHS;
          else if (e.key === "PageUp") to = Math.floor(t) + 3;
          else if (e.key === "PageDown") to = Math.ceil(t) - 3;
          if (to === null) return;
          e.preventDefault();
          if (engine.playing) engine.pause();
          seek(Math.max(0, Math.min(TIMELINE_MONTHS, to)));
          e.currentTarget.value = String(Math.max(0, Math.min(TIMELINE_MONTHS, to)));
        }}
      />
      <div className="mt-1 flex justify-between text-[12px] text-muted" aria-hidden>
        {[0, 3, 6, 9, 12, 15].map((m) => (
          <span key={m} className="num">
            {m === 0 ? "Month 0" : m}
          </span>
        ))}
      </div>
    </div>
  );
}
