"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { IconBadge, Pane, cx } from "@/components/ui";
import { usd } from "@/lib/format";
import { SALE_FLOW_MONTHS, TIMELINE_MONTHS, frameAt, type Absorbed, type Timeline } from "@/lib/stressTimeline";
import { CityGrid, type CityGridHandle } from "./CityGrid";
import { LAYERS, LAYER_NAME, LossTanks, type LayerKey, type TanksHandle } from "./LossTanks";
import { PriceGauge, type PriceHandle } from "./PriceGauge";
import { approach, type TimelineEngine } from "./useTimeline";

// One side of the comparison (GlassHouse or the 2008-style lender). Everything that moves is
// drawn from the engine's tick straight into the DOM; React renders this once per scenario.

const MAX_PARTICLES = 40;

interface Particle {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  t0: number;
  dur: number;
}

export function CrashSide({
  title,
  subtitle,
  icon,
  tone,
  timeline,
  kind,
  engine,
  verdict,
  compact = false,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tone: "accent" | "bad";
  timeline: Timeline;
  kind: "house" | "vehicle";
  engine: TimelineEngine;
  verdict: { text: string; bad: boolean };
  compact?: boolean;
  children?: ReactNode;
}) {
  const grid = useRef<CityGridHandle>(null);
  const tanks = useRef<TanksHandle>(null);
  const price = useRef<PriceHandle>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<SVGSVGElement | null>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const parts = useRef<(Particle | null)[]>(Array(MAX_PARTICLES).fill(null));
  const c = useRef<Record<"month" | "defaults" | "drop" | "loss", HTMLElement | null>>({ month: null, defaults: null, drop: null, loss: null });
  const bankFill = useRef<HTMLDivElement | null>(null);
  const bankBox = useRef<HTMLDivElement | null>(null);
  const bankLeft = useRef<HTMLSpanElement | null>(null);
  const disp = useRef<{ a: Absorbed; loss: number; idx: number; bank: number | null } | null>(null);
  const prevT = useRef(0);
  const text = useRef<Record<string, string>>({});

  const { subscribe, wake } = engine;
  const tl = timeline;

  useEffect(() => {
    const setText = (key: string, el: HTMLElement | null, v: string) => {
      if (el && text.current[key] !== v) {
        text.current[key] = v;
        el.textContent = v;
      }
    };

    const spawn = (from: number, to: LayerKey, now: number) => {
      const ov = overlay.current?.getBoundingClientRect();
      const a = grid.current?.pointOf(from);
      const b = tanks.current?.surfaceOf(to);
      if (!ov || !a || !b) return;
      const slot = parts.current.findIndex((p) => p === null);
      if (slot < 0) return;
      const x0 = a.x - ov.left;
      const y0 = a.y - ov.top;
      const x1 = b.x - ov.left + (Math.random() - 0.5) * 14;
      const y1 = b.y - ov.top;
      parts.current[slot] = {
        x0,
        y0,
        x1,
        y1,
        cx: (x0 + x1) / 2 + (Math.random() - 0.5) * 60,
        cy: Math.min(y0, y1) - 30 - Math.random() * 50,
        t0: now + Math.random() * 120,
        dur: 600 + Math.random() * 300,
      };
    };

    const targetLayer = (a: Absorbed): LayerKey => {
      if (tl.capacity.firstLoss > 0 && a.firstLoss < tl.capacity.firstLoss) return "firstLoss";
      if (tl.capacity.reserve > 0 && a.reserve < tl.capacity.reserve) return "reserve";
      return "investors";
    };

    return subscribe(({ t, dt, advancing, instant }) => {
      const f = frameAt(tl, t);
      const d = disp.current ?? (disp.current = { a: { ...f.absorbed }, loss: f.realizedLoss, idx: f.priceIndex, bank: f.bankEquityLeft });
      let busy = false;
      for (const k of LAYERS) {
        d.a[k] = approach(d.a[k], f.absorbed[k], dt, instant);
        if (d.a[k] !== f.absorbed[k]) busy = true;
      }
      d.loss = approach(d.loss, f.realizedLoss, dt, instant);
      d.idx = approach(d.idx, f.priceIndex, dt, instant, 1e-5);
      d.bank = f.bankEquityLeft === null ? null : approach(d.bank ?? f.bankEquityLeft, f.bankEquityLeft, dt, instant);
      if (d.loss !== f.realizedLoss || d.idx !== f.priceIndex || d.bank !== f.bankEquityLeft) busy = true;

      grid.current?.draw(t);
      tanks.current?.draw(d.a);
      price.current?.draw(t, tl.scenario.priceDrop, d.idx);

      setText("month", c.current.month, `${Math.min(TIMELINE_MONTHS, Math.floor(t + 1e-9))}`);
      setText("defaults", c.current.defaults, `${f.defaulted + f.sold}/${tl.plan.length}`);
      setText("drop", c.current.drop, `−${Math.round((1 - d.idx) * 100)}%`);
      setText("loss", c.current.loss, usd(d.loss));

      if (tl.bankEquity !== null && d.bank !== null) {
        const share = tl.bankEquity > 0 ? d.bank / tl.bankEquity : 0;
        if (bankFill.current) bankFill.current.style.transform = `scaleX(${share.toFixed(4)})`;
        bankBox.current?.setAttribute("data-broken", f.bankEquityLeft === 0 && tl.bankEquity > 0 ? "1" : "0");
        setText("bank", bankLeft.current, f.bankEquityLeft === 0 ? "Wiped out" : `${usd(d.bank)} left`);
      }

      // Particles: a few red drops from each house as its sale's loss starts to flow.
      const now = performance.now();
      if (advancing && !instant && t - prevT.current < 1) {
        for (const p of tl.plan) {
          const start = p.soldAt - SALE_FLOW_MONTHS;
          if (start > prevT.current && start <= t) {
            const to = targetLayer(f.absorbed);
            if (tl.collateralUsedPerLoan > 0) spawn(p.index, "collateral", now);
            for (let i = 0; i < 3; i++) spawn(p.index, to, now);
          }
        }
      }
      prevT.current = t;
      parts.current.forEach((p, i) => {
        const el = dots.current[i];
        if (!el) return;
        if (!p) {
          if (el.style.opacity !== "0") el.style.opacity = "0";
          return;
        }
        busy = true;
        const k = (now - p.t0) / p.dur;
        if (k >= 1 || instant) {
          parts.current[i] = null;
          el.style.opacity = "0";
          return;
        }
        if (k < 0) return;
        const u = 1 - k;
        const x = u * u * p.x0 + 2 * u * k * p.cx + k * k * p.x1;
        const y = u * u * p.y0 + 2 * u * k * p.cy + k * k * p.y1;
        el.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        el.style.opacity = k > 0.85 ? String((1 - k) / 0.15) : "1";
      });
      return busy;
    });
  }, [subscribe, tl]);

  // A new scenario: draw it at the current month (eases from what is on screen).
  useEffect(() => wake(), [tl, kind, wake]);

  const stat = (label: string, key: keyof typeof c.current, initial: string) => (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd
        ref={(el) => {
          c.current[key] = el;
        }}
        className="num text-[17px] font-bold leading-tight"
      >
        {initial}
      </dd>
    </div>
  );

  return (
    <Pane className={cx("relative overflow-hidden", tone === "bad" ? "border-bad/30" : verdict.bad ? "border-bad/35" : "border-ok/30", compact && "p-4")}>
      <div ref={wrap}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="title inline-flex items-center gap-2.5 text-lg">
            <IconBadge icon={icon} size="sm" tone={tone} /> {title}
          </h2>
          <span className="text-sm text-muted">{subtitle}</span>
        </div>

        <p
          className={cx(
            "display mt-2 min-h-[1.2em] text-[30px] transition-opacity duration-500 sm:text-[36px]",
            verdict.bad ? "text-bad-fg" : "text-ok",
            engine.ended ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={!engine.ended}
        >
          {verdict.text}
        </p>

        {/* Compact (the 1920×1080 presentation view): grid, numbers and tanks side by side. */}
        <div className={cx("mt-2 grid gap-4", compact ? "grid-cols-[200px_minmax(0,1fr)_minmax(0,400px)] items-center gap-5" : "sm:grid-cols-[minmax(0,230px)_minmax(0,1fr)]")}>
          <div className="mx-auto w-full max-w-[260px]">
            <CityGrid ref={grid} plan={tl.plan} kind={kind} />
          </div>
          <div className="flex min-w-0 flex-col justify-between gap-3">
            <div className="max-w-[320px]">
              <PriceGauge ref={price} price={tl.scenario.price} drop={tl.scenario.priceDrop} label={kind === "house" ? "Home price" : "Car price"} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              {stat("Month", "month", "0")}
              {stat("Defaults", "defaults", `0/${tl.plan.length}`)}
              {stat("Price", "drop", "−0%")}
              {stat("Total loss", "loss", "$0")}
            </dl>
          </div>
          {compact ? <LossTanks ref={tanks} capacity={tl.capacity} /> : null}
        </div>

        {compact ? null : (
          <div className="mx-auto mt-3 w-full max-w-[520px]">
            <LossTanks ref={tanks} capacity={tl.capacity} />
          </div>
        )}

        {tl.bankEquity !== null ? (
          <div className="mt-3">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold">Bank equity (30x leverage)</span>
              <span ref={bankLeft} className="num font-semibold text-muted">
                {usd(tl.bankEquity)} left
              </span>
            </div>
            <div ref={bankBox} className="gh-bank mt-1.5" data-broken="0" aria-hidden>
              <div ref={bankFill} className="gh-bank-fill" />
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="gh-bank-crack">
                <path d="M46 0 L52 3.5 L47 5.5 L54 10" fill="none" />
              </svg>
            </div>
            <p className="mt-1.5 text-[12.5px] text-muted">Calculation only: the program doesn&apos;t model bank leverage.</p>
          </div>
        ) : null}
        {children}
      </div>

      <svg ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden focusable="false">
        {Array.from({ length: MAX_PARTICLES }, (_, i) => (
          <circle
            key={i}
            ref={(el) => {
              dots.current[i] = el;
            }}
            r={3}
            className="gh-particle"
            style={{ opacity: 0 }}
          />
        ))}
      </svg>
    </Pane>
  );
}

export { LAYER_NAME };
