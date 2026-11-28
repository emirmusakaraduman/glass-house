"use client";

import { AlertTriangle, Car, Flame, Home, Pause, Play, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Button, cx } from "@/components/ui";
import { TIMELINE_MONTHS } from "@/lib/stressTimeline";
import { SPEEDS, type TimelineEngine } from "./useTimeline";

// The sticky control strip of /stress. Desktop (lg+): pool, three sliders, reset and the one
// gold button on the first row; the timeline on the second. Smaller screens: one row with the
// gold button, the month and a Settings panel holding the rest.

export type Pool = "house" | "vehicle";

export interface SliderSpec {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  unit?: string;
  onChange: (v: number) => void;
  marker?: { at: number; label: string; detail: string };
}

/** The page's one gold button: Run the crash / Pause / Replay. `onStart` runs when it starts playing. */
export function RunButton({ engine, onStart, className }: { engine: TimelineEngine; onStart?: () => void; className?: string }) {
  const Icon = engine.playing ? Pause : engine.ended ? RotateCcw : Play;
  const label = engine.playing ? "Pause" : engine.ended ? "Replay" : engine.month > 0 ? "Resume" : "Run the crash";
  return (
    <Button
      onClick={() => {
        const starting = !engine.playing;
        engine.toggle();
        if (starting) onStart?.();
      }}
      className={cx("h-10 min-w-[160px] px-5", className)}
      aria-keyshortcuts="Space"
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      {label}
    </Button>
  );
}

function PoolToggle({ value, onChange }: { value: Pool; onChange: (p: Pool) => void }) {
  const options = [
    { v: "house" as const, icon: Home, label: "Home pool" },
    { v: "vehicle" as const, icon: Car, label: "Car pool" },
  ];
  return (
    <div role="group" aria-label="Pool" className="inline-flex shrink-0 rounded-full border border-haze/10 bg-haze/[0.04] p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          title={o.label}
          onClick={() => onChange(o.v)}
          className={cx("inline-flex h-9 w-10 items-center justify-center rounded-full transition-colors", value === o.v ? "fill-accent" : "text-muted hover:bg-haze/[0.06] hover:text-ink")}
        >
          <o.icon className="h-[18px] w-[18px]" aria-hidden />
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function EstimateBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[12px] font-semibold text-warn">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Estimate
    </span>
  );
}

function EffectsButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={on ? "Effects on (flames, shake, pulse)" : "Effects off: still states only"}
      className={cx(
        "inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12px] font-semibold transition-colors",
        on ? "border-warn/50 bg-warn/10 text-warn" : "border-haze/15 text-muted hover:text-ink",
      )}
    >
      <Flame className="h-4 w-4" aria-hidden />
      Effects
    </button>
  );
}

function ResetButton({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      title="Reset to the doc's scenario"
      aria-label="Reset to the doc's scenario"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-accent/30 text-ink transition-colors hover:border-accent/60 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <RotateCcw className="h-4 w-4" aria-hidden />
    </button>
  );
}

/** Label left, value right, a thin slider under them. The break-even tick explains itself on hover or focus. */
function MiniSlider({ s }: { s: SliderSpec }) {
  const hintId = useId();
  const fill = ((s.value - s.min) / (s.max - s.min)) * 100;
  const markAt = s.marker ? ((s.marker.at - s.min) / (s.max - s.min)) * 100 : null;
  return (
    <label className="group relative block min-w-0 rounded-xl border border-haze/[0.08] bg-haze/[0.03] px-3 pb-0.5 pt-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] text-muted">{s.label}</span>
        <span className="num shrink-0 text-[15px] font-bold leading-tight text-steel">
          {s.display}
          {s.unit ? <span className="ml-1 text-[12px] font-normal text-muted">{s.unit}</span> : null}
        </span>
      </span>
      <span className="relative mt-0.5 block">
        <input
          type="range"
          min={s.min}
          max={s.max}
          step={s.step}
          value={s.value}
          onChange={(e) => s.onChange(Number(e.target.value))}
          className="gh-range gh-range-sm block"
          style={{ ["--fill" as string]: `${fill}%` }}
          aria-valuetext={s.unit ? `${s.display} ${s.unit}` : s.display}
          aria-describedby={s.marker ? hintId : undefined}
        />
        {markAt !== null ? <span className="gh-mark gh-mark-sm pointer-events-none" style={{ left: `calc(8px + (100% - 16px) * ${markAt / 100})` }} aria-hidden /> : null}
      </span>
      {s.marker && markAt !== null ? (
        <span
          id={hintId}
          role="tooltip"
          className="pointer-events-none absolute top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-bad/40 bg-night px-2 py-1 text-[12px] font-semibold text-bad-fg opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          style={{ left: `clamp(0px, calc(${markAt}% - 100px), calc(100% - 240px))` }}
        >
          ▲ {s.marker.label} <span className="font-normal">({s.marker.detail})</span>
        </span>
      ) : null}
    </label>
  );
}

function SpeedPicker({ engine }: { engine: TimelineEngine }) {
  return (
    <div role="group" aria-label="Speed" className="inline-flex shrink-0 rounded-full border border-haze/10 bg-haze/[0.04] p-0.5">
      {SPEEDS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={engine.speed === s}
          onClick={() => engine.setSpeed(s)}
          className={cx("num h-5 rounded-full px-2 text-[12px] font-semibold leading-none transition-colors", engine.speed === s ? "fill-accent" : "text-muted hover:text-ink")}
        >
          {s}x
        </button>
      ))}
    </div>
  );
}

const pctOf = (m: number) => `${(m / TIMELINE_MONTHS) * 100}%`;

/** Months 0–15: phases in one row above, the scrubber, month numbers below. Arrow keys step a month. */
export function TimelineRow({ engine, asset }: { engine: TimelineEngine; asset: "home" | "car" }) {
  const input = useRef<HTMLInputElement | null>(null);
  const { subscribe, seek, getT, playing, pause } = engine;

  useEffect(
    () =>
      subscribe(({ t }) => {
        const el = input.current;
        if (!el) return;
        if (document.activeElement !== el || playing) el.value = String(t);
        el.style.setProperty("--fill", pctOf(t));
      }),
    [subscribe, playing],
  );

  const phases = [
    { label: "Prices fall", from: 0, to: 6, row: 0, cls: "bg-accent" },
    { label: "Payments missed", from: 1, to: 3, row: 1, cls: "bg-warn" },
    { label: `${asset === "home" ? "Homes" : "Cars"} sold`, from: 4, to: 15, row: 1, cls: "bg-bad" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-none">
          <span className="num font-semibold text-ink">
            Month {engine.month}/{TIMELINE_MONTHS}
          </span>
          {phases.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5 text-muted">
              <span className={cx("h-1.5 w-3 rounded-full", p.cls)} aria-hidden />
              {p.label}
              <span className="num">
                {p.from}–{p.to}
              </span>
            </span>
          ))}
        </div>
        <SpeedPicker engine={engine} />
      </div>
      <div className="relative mt-1 h-[6px]" aria-hidden>
        {phases.map((p) => (
          <span
            key={p.label}
            className={cx("absolute h-[2.5px] rounded-full opacity-80", p.cls, p.row === 0 ? "top-0" : "top-[3.5px]")}
            style={{ left: `calc(8px + (100% - 16px) * ${p.from / TIMELINE_MONTHS})`, width: `calc((100% - 16px) * ${(p.to - p.from) / TIMELINE_MONTHS})` }}
          />
        ))}
      </div>
      <input
        ref={input}
        type="range"
        min={0}
        max={TIMELINE_MONTHS}
        step={0.01}
        defaultValue={0}
        className="gh-range gh-range-sm block"
        aria-label="Month of the crash"
        aria-valuetext={`Month ${engine.month} of ${TIMELINE_MONTHS}`}
        onChange={(e) => seek(Number(e.target.value))}
        onPointerDown={() => playing && pause()}
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
          if (playing) pause();
          const m = Math.max(0, Math.min(TIMELINE_MONTHS, to));
          seek(m);
          e.currentTarget.value = String(m);
        }}
      />
      <div className="flex justify-between px-1 text-[12px] leading-none text-muted" aria-hidden>
        {[0, 3, 6, 9, 12, 15].map((m) => (
          <span key={m} className="num">
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ControlStrip({
  engine,
  pool,
  onPool,
  sliders,
  onReset,
  resetDisabled,
  onStart,
  present = false,
  stripRef,
  effects,
  onEffects,
}: {
  engine: TimelineEngine;
  pool: Pool;
  onPool: (p: Pool) => void;
  sliders: SliderSpec[];
  onReset: () => void;
  resetDisabled: boolean;
  effects: boolean;
  onEffects: () => void;
  onStart?: () => void;
  present?: boolean;
  stripRef?: Ref<HTMLDivElement>;
}) {
  const [open, setOpen] = useState(false);
  const asset = pool === "house" ? "home" : "car";
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const wide = (
    <div className="space-y-1.5 px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        <PoolToggle value={pool} onChange={onPool} />
        {pool === "vehicle" ? <EstimateBadge /> : null}
        <div className="grid min-w-0 flex-1 grid-cols-3 gap-2">
          {sliders.map((s) => (
            <MiniSlider key={s.key} s={s} />
          ))}
        </div>
        <EffectsButton on={effects} onToggle={onEffects} />
        <ResetButton onReset={onReset} disabled={resetDisabled} />
        <RunButton engine={engine} onStart={onStart} />
      </div>
      <div className="px-1">
        <TimelineRow engine={engine} asset={asset} />
      </div>
    </div>
  );

  return (
    <div ref={stripRef} className={cx("rounded-2xl border border-haze/10 shadow-[0_8px_24px_rgb(0_0_0/0.35)]", present ? "bg-night/70" : "gh-strip")}>
      {present ? (
        wide
      ) : (
        <>
          <div className="hidden lg:block">{wide}</div>
          <div className="lg:hidden">
            <div className="flex items-center gap-2 p-2">
              <RunButton engine={engine} onStart={onStart} className="min-w-[136px] px-4" />
              <span className="num shrink-0 px-1 text-[13px] font-semibold">
                Month {engine.month}/{TIMELINE_MONTHS}
              </span>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((o) => !o)}
                className="ml-auto inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-accent/30 px-3.5 text-[14px] font-semibold text-ink hover:border-accent/60 hover:bg-accent/10"
              >
                {open ? <X className="h-4 w-4" aria-hidden /> : <SlidersHorizontal className="h-4 w-4" aria-hidden />}
                Settings
              </button>
            </div>
            <div id={panelId} hidden={!open} className="max-h-[70vh] space-y-3 overflow-y-auto border-t border-haze/10 p-3">
              <div className="flex items-center gap-2">
                <PoolToggle value={pool} onChange={onPool} />
                {pool === "vehicle" ? <EstimateBadge /> : null}
                <span className="ml-auto" />
                <EffectsButton on={effects} onToggle={onEffects} />
                <ResetButton onReset={onReset} disabled={resetDisabled} />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {sliders.map((s) => (
                  <MiniSlider key={s.key} s={s} />
                ))}
              </div>
              <TimelineRow engine={engine} asset={asset} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
