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
  size = "page",
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
  /** "present": the 1920×1080 video view, drawn larger. */
  size?: "page" | "present";
  children?: ReactNode;
}) {
  const grid = useRef<CityGridHandle>(null);
  const tanks = useRef<TanksHandle>(null);
  const price = useRef<PriceHandle>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<SVGSVGElement | null>(null);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const parts = useRef<(Particle | null)[]>(Array(MAX_PARTICLES).fill(null));
  const c = useRef<Record<"month" | "defaults" | "drop" | "loss" | "interim", HTMLElement | null>>({ month: null, defaults: null, drop: null, loss: null, interim: null });
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
        // Short and direct: a slight lift, never up into the price strip above the grid.
        cx: (x0 + x1) / 2 + (Math.random() - 0.5) * 24,
        cy: Math.min(y0, y1) - 8 - Math.random() * 16,
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
      const money = Math.max(1, tl.result.totalLoss + tl.capacity.collateral);
      for (const k of LAYERS) {
        d.a[k] = approach(d.a[k], f.absorbed[k], dt, instant, 0.005, money);
        if (d.a[k] !== f.absorbed[k]) busy = true;
      }
      d.loss = approach(d.loss, f.realizedLoss, dt, instant, 0.005, money);
      d.idx = approach(d.idx, f.priceIndex, dt, instant, 1e-5, Math.max(0.01, tl.scenario.priceDrop));
      d.bank = f.bankEquityLeft === null ? null : approach(d.bank ?? f.bankEquityLeft, f.bankEquityLeft, dt, instant, 0.005, Math.max(1, tl.bankEquity ?? 1));
      if (d.loss !== f.realizedLoss || d.idx !== f.priceIndex || d.bank !== f.bankEquityLeft) busy = true;

      grid.current?.draw(t);
      tanks.current?.draw(d.a);
      price.current?.draw(t, tl.scenario.priceDrop, d.idx);

      setText("month", c.current.month, `${Math.min(TIMELINE_MONTHS, Math.floor(t + 1e-9))}`);
      setText("defaults", c.current.defaults, `${f.defaulted + f.sold}/${tl.plan.length}`);
      setText("drop", c.current.drop, `−${Math.round((1 - d.idx) * 100)}%`);
      setText("loss", c.current.loss, usd(d.loss));
      setText("interim", c.current.interim, `Investors: ${usd(d.a.investors)} lost so far`);

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

  const stat = (label: string, key: "month" | "defaults" | "drop" | "loss", initial: string) => (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1">
      <dt className="text-[12px] leading-tight text-muted">{label}</dt>
      <dd
        ref={(el) => {
          c.current[key] = el;
        }}
        className="num text-[15px] font-bold leading-tight"
      >
        {initial}
      </dd>
    </div>
  );
  const big = size === "present";

  return (
    <Pane className={cx("relative overflow-hidden p-4 sm:p-4", tone === "bad" ? "border-bad/30" : verdict.bad ? "border-bad/35" : "border-ok/30")}>
      <div ref={wrap} className="space-y-2.5">
        {/* Name on the left, the verdict on the right: the answer is in the first line. */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 sm:flex-nowrap">
          <div className="min-w-0 sm:flex-1">
            <h2 className="title inline-flex items-center gap-2 text-[17px] leading-tight">
              <IconBadge icon={icon} size="sm" tone={tone} /> {title}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-muted" title={subtitle}>
              {subtitle}
            </p>
          </div>
          <div className="min-h-[28px] w-full sm:min-h-[34px] sm:w-auto sm:shrink-0 sm:whitespace-nowrap sm:text-right">
            <p
              className={cx("display leading-none transition-opacity duration-500", big ? "text-[34px]" : "text-[22px] sm:text-[24px] 2xl:text-[28px]", verdict.bad ? "text-bad-fg" : "text-ok", engine.ended ? "opacity-100" : "hidden opacity-0")}
              aria-hidden={!engine.ended}
            >
              {verdict.text}
            </p>
            <p
              ref={(el) => {
                c.current.interim = el;
              }}
              className={cx("num pt-1.5 text-[14px] font-semibold text-muted", engine.ended && "hidden")}
              aria-hidden
            >
              Investors: $0 lost so far
            </p>
          </div>
        </div>

        <PriceGauge ref={price} price={tl.scenario.price} drop={tl.scenario.priceDrop} label={kind === "house" ? "Home price" : "Car price"} />

        {/* Grid left, tanks right (stacked on phones). The price strip above keeps particles off it. */}
        <div className={cx("grid items-start gap-4", big ? "grid-cols-[250px_minmax(0,1fr)] gap-8" : "sm:grid-cols-[minmax(170px,206px)_minmax(0,1fr)]")}>
          <div className={cx("mx-auto w-full", big ? "max-w-[250px]" : "max-w-[230px] sm:max-w-none")}>
            <CityGrid ref={grid} plan={tl.plan} kind={kind} />
          </div>
          <div className={cx("mx-auto w-full", big ? "max-w-[380px]" : "max-w-[300px]")}>
            <LossTanks ref={tanks} capacity={tl.capacity} />
          </div>
        </div>

        {tl.bankEquity !== null ? (
          <div>
            <div className="flex items-center gap-3 text-[12px]">
              <span className="shrink-0 font-semibold">Bank equity (30x leverage)</span>
              <div ref={bankBox} className="gh-bank min-w-0 flex-1" data-broken="0" aria-hidden>
                <div ref={bankFill} className="gh-bank-fill" />
                <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="gh-bank-crack">
                  <path d="M46 0 L52 3.5 L47 5.5 L54 10" fill="none" />
                </svg>
              </div>
              <span ref={bankLeft} className="num shrink-0 font-semibold text-muted">
                {usd(tl.bankEquity)} left
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted">Calculation only: the program doesn&apos;t model bank leverage.</p>
          </div>
        ) : null}

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("Month", "month", "0")}
          {stat("Defaults", "defaults", `0/${tl.plan.length}`)}
          {stat("Price", "drop", "−0%")}
          {stat("Total loss", "loss", "$0")}
        </dl>
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
