"use client";

import { AlertTriangle, Building2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LossStack } from "@/components/LossStack";
import { ControlStrip, type SliderSpec } from "@/components/stress/CrashControls";
import { CrashSide } from "@/components/stress/CrashSide";
import { useTimeline } from "@/components/stress/useTimeline";
import { Note, Pane, PaneTitle, Row, cx } from "@/components/ui";
import { pct, usd } from "@/lib/format";
import { HOUSE_STRESS_BASE, VEHICLE_STRESS_BASE, lender2008, leveragedBank, runStress, type StressResult, type StressScenario } from "@/lib/stress";
import { buildTimeline, frameAt } from "@/lib/stressTimeline";

type Tab = "house" | "vehicle";

// The doc's headline scenario: 30% price drop, 20 defaults out of 100, 15% sale and legal costs.
const DOC = { drop: 0.3, defaults: 20, cost: 0.15 };

/** Verdict from the computed result, never fixed text. "Nothing" only when the loss is exactly 0. */
function verdictOf(r: StressResult, digits: number) {
  return r.toInvestors > 0 ? { text: `Investors lose ${pct(r.toInvestorsPct, digits)}`, bad: true } : { text: "Investors lose nothing", bad: false };
}

export default function StressPage() {
  const [tab, setTab] = useState<Tab>("house");
  const base = tab === "house" ? HOUSE_STRESS_BASE : VEHICLE_STRESS_BASE;
  const [drop, setDrop] = useState(DOC.drop);
  const [defaults, setDefaults] = useState(DOC.defaults);
  const [cost, setCost] = useState(DOC.cost);
  const [present, setPresent] = useState(false);

  // Collapse effects: on by default, the choice is remembered on this device. Always on in ?present=1.
  const [effectsPref, setEffectsPref] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("gh-stress-effects") === "off") setEffectsPref(false);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);
  const toggleEffects = () =>
    setEffectsPref((on) => {
      try {
        window.localStorage.setItem("gh-stress-effects", on ? "off" : "on");
      } catch {
        /* storage blocked: the toggle still works for this visit */
      }
      return !on;
    });
  const effects = present || effectsPref;

  const s: StressScenario = useMemo(() => ({ ...base, priceDrop: drop, defaults, saleCost: cost }), [base, drop, defaults, cost]);
  const gh = useMemo(() => runStress(s), [s]);
  const old = useMemo(() => lender2008(s), [s]);
  const oldR = useMemo(() => runStress(old), [old]);
  const bank = useMemo(() => leveragedBank(old), [old]);
  const ghTl = useMemo(() => buildTimeline(s), [s]);
  const oldTl = useMemo(() => buildTimeline(old, { withBank: true }), [old]);
  const senior = s.loans * s.loanSize - s.firstLossVault;
  const asset = tab === "house" ? "home" : "car";
  const atDoc = drop === DOC.drop && defaults === DOC.defaults && cost === DOC.cost;
  const resetToDoc = () => {
    setDrop(DOC.drop);
    setDefaults(DOC.defaults);
    setCost(DOC.cost);
  };

  const simRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const engine = useTimeline(simRef);

  // Page-level effects: a thin red vignette while either panel is collapsed, one pulse at a collapse
  // moment, and one spoken line per collapse. Level changes are rare, so a ref plus DOM writes.
  const vignette = useRef<HTMLDivElement | null>(null);
  const levels = useRef<Record<"gh" | "old", number>>({ gh: 0, old: 0 });
  const [alarm, setAlarm] = useState("");
  // The vignette is fixed to the viewport, so it lives in <body> (a transformed parent would trap it).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const onFx = (side: "gh" | "old") => (level: number, moment: boolean) => {
    const was = levels.current[side];
    levels.current[side] = level;
    const v = vignette.current;
    if (v) {
      v.dataset.on = levels.current.gh === 2 || levels.current.old === 2 ? "1" : "0";
      if (moment) {
        v.dataset.pulse = "0";
        void v.offsetWidth;
        v.dataset.pulse = "1";
      } else if (v.dataset.on === "0") v.dataset.pulse = "0";
    }
    if (level === 2 && was !== 2) setAlarm(side === "gh" ? "GlassHouse: investors hit" : "2008-style lender: bank wiped out");
  };
  const onFxGh = useRef(onFx("gh")).current;
  const onFxOld = useRef(onFx("old")).current;

  // The strip sticks right under the sticky top bar (lg+); its height can change, so measure it.
  useEffect(() => {
    const bar = document.querySelector("main")?.previousElementSibling as HTMLElement | null;
    if (!bar) return;
    const set = () => document.documentElement.style.setProperty("--gh-topbar-h", `${bar.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  /** On Run: if the panels aren't fully in view, scroll them up under the strip (instantly with reduced motion). */
  const revealPanels = () => {
    const panels = panelsRef.current;
    const strip = stripRef.current;
    if (!panels || !strip || present) return;
    const top = strip.getBoundingClientRect().bottom + 12;
    const r = panels.getBoundingClientRect();
    if (r.top >= top - 1 && r.bottom <= window.innerHeight) return;
    window.scrollBy({ top: r.top - top, behavior: engine.reducedMotion ? "auto" : "smooth" });
  };
  const { toggle, play } = engine;

  // ?present=1: full-screen view for the video, starts on its own after a second.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("present") === "1") setPresent(true);
  }, []);
  useEffect(() => {
    if (!present) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [present]);
  useEffect(() => {
    if (!present) return;
    const id = window.setTimeout(play, 1000);
    return () => window.clearTimeout(id);
  }, [present, play]);

  // Space plays and pauses, unless a control that uses Space has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, a, [role=tab], [contenteditable=true]")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // One short spoken summary per month, at most one a second.
  const [said, setSaid] = useState("");
  const lastSaid = useRef(0);
  const pending = useRef<number | null>(null);
  useEffect(() => {
    if (engine.month === 0 && !engine.playing) return;
    const f = frameAt(ghTl, engine.month);
    const o = frameAt(oldTl, engine.month);
    const msg = `Month ${engine.month}: ${f.sold} ${asset}s sold, first-loss vault absorbed ${usd(f.absorbed.firstLoss)}, investors ${usd(f.absorbed.investors)}. 2008-style lender: investors ${usd(o.absorbed.investors)}.`;
    const wait = Math.max(0, 1000 - (Date.now() - lastSaid.current));
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      lastSaid.current = Date.now();
      pending.current = null;
      setSaid(msg);
    }, wait);
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, [engine.month, engine.playing, ghTl, oldTl, asset]);

  const ghVerdict = verdictOf(gh, 2);
  const oldVerdict = verdictOf(oldR, 1);
  const showBreakEven = tab === "house" && defaults > 0 && gh.breakEvenDrop > 0 && gh.breakEvenDrop < 0.6;

  const sliders: SliderSpec[] = [
    {
      key: "drop",
      label: `${asset === "home" ? "Home" : "Car"} price drop`,
      value: drop,
      min: 0,
      max: 0.6,
      step: 0.01,
      display: pct(drop, 0),
      onChange: setDrop,
      marker: showBreakEven ? { at: gh.breakEvenDrop, label: "Investors start losing here", detail: `at about ${pct(gh.breakEvenDrop, 1)}` } : undefined,
    },
    { key: "defaults", label: "Defaults", value: defaults, min: 0, max: 50, step: 1, display: `${defaults}`, unit: `of ${s.loans}`, onChange: setDefaults },
    { key: "cost", label: "Sale and legal costs", value: cost, min: 0.05, max: 0.25, step: 0.01, display: pct(cost, 0), onChange: setCost },
  ];

  const strip = (
  <ControlStrip
    engine={engine}
    pool={tab}
    onPool={(v) => {
      setTab(v);
      setDrop(DOC.drop);
    }}
    sliders={sliders}
    onReset={resetToDoc}
    resetDisabled={atDoc}
    onStart={revealPanels}
    present={present}
    stripRef={stripRef}
    effects={effects}
    onEffects={toggleEffects}
  />
  );

  const sim = (
    <div ref={simRef} className="space-y-4">

      {/* ------------------------------------------------------------ the two sides, one clock */}
      <div ref={panelsRef} className={cx("grid items-start gap-4", present ? "grid-cols-2 gap-5" : "xl:grid-cols-2")}>
        <CrashSide
          title="GlassHouse"
          subtitle={`max LTV ${pct(s.loanSize / s.price, 0)}, first-loss ${usd(s.firstLossVault, { compact: true })}`}
          icon={ShieldCheck}
          tone="accent"
          timeline={ghTl}
          kind={tab}
          engine={engine}
          verdict={ghVerdict}
          size={present ? "present" : "page"}
          effects={effects}
          onFx={onFxGh}
        />
        <CrashSide
          title="2008-style lender"
          subtitle="Same program at LTV 97%, no first-loss"
          icon={Building2}
          tone="bad"
          timeline={oldTl}
          kind={tab}
          engine={engine}
          verdict={oldVerdict}
          size={present ? "present" : "page"}
          effects={effects}
          onFx={onFxOld}
        />
      </div>
      <p className="text-[12.5px] text-muted">
        Model calculation with the same assumptions as the design doc. Every defaulted {asset} is sold at the scenario&apos;s price drop; the curve shows the market getting there.
      </p>
      <p className="sr-only" aria-live="polite">
        {alarm}
      </p>
      {mounted ? createPortal(<div ref={vignette} className="gh-vignette" data-on="0" data-pulse="0" aria-hidden />, document.body) : null}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
    </div>
  );

  // The presentation view goes straight into <body>: a parent with a transform would trap `fixed`.
  if (present) {
    return createPortal(
      <div data-theme="dark" className="fixed inset-0 z-[70] overflow-y-auto bg-frost px-6 py-5 xl:px-10">
        <div className="mx-auto max-w-[1840px] space-y-4">
          <h1 className="title text-gradient text-[28px] leading-none">Stress test: the same crash, two lenders</h1>
          {strip}
          {sim}
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div className="space-y-4">
      {strip}
      {sim}
      <div className="h-2" aria-hidden />
      {/* Below the animation; hidden in the presentation view. */}
        <>
          {tab === "vehicle" ? (
            <Note tone="warn">
              Car figures are an estimate. Damage, theft, cars that can&apos;t be found and used-car discounts are not modeled, so we don&apos;t claim a break-even point for cars.
            </Note>
          ) : null}
          {/* ------------------------------------------------------------ the numbers (same as the last frame) */}
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Pane className={cx(gh.toInvestors > 0 ? "border-bad/35" : "border-ok/30")}>
              <PaneTitle aside="at month 15">GlassHouse, in numbers</PaneTitle>
              <p className={cx("title mb-4 text-xl", gh.toInvestors > 0 ? "text-bad-fg" : "text-ok")}>{ghVerdict.text}</p>
              <LossStack
                layers={[
                  {
                    name: "Borrowers' collateral",
                    owner: `${defaults} × ${usd(gh.collateralPerLoan)}`,
                    capacity: defaults * gh.collateralPerLoan,
                    used: Math.min(defaults * gh.collateralPerLoan, defaults * Math.max(0, gh.claimPerLoan - gh.netSalePerLoan)),
                  },
                  { name: "First-loss vault", owner: "platform capital", capacity: s.firstLossVault, used: gh.absorbedByFirstLoss },
                  { name: "Reserve fund", owner: "from fees", capacity: s.reserve, used: gh.absorbedByReserve },
                  { name: "Investors", owner: "senior principal", capacity: senior, used: gh.toInvestors, senior: true },
                ]}
                caption={`Each defaulted ${asset} is sold first. The sale covers ${usd(gh.netSalePerLoan)} of the ${usd(gh.claimPerLoan)} owed per loan.`}
              />
              <div className="mt-5 border-t border-haze/[0.08] pt-3 text-[15px]">
                <Row k="Owed per defaulted loan, with 15 months of interest" v={usd(gh.claimPerLoan)} />
                <Row k={`Net sale per ${asset}`} v={usd(gh.netSalePerLoan)} />
                <Row k="Gap per loan after collateral" v={usd(gh.gapPerLoan)} />
                <Row k="Total loss" v={usd(gh.totalLoss)} strong />
                {gh.toInvestors > 0 ? <Row k="Reaches investors" v={`${usd(gh.toInvestors)} (${pct(gh.toInvestorsPct, 2)})`} strong /> : null}
                {tab === "house" ? <Row k="Break-even price drop at these settings" v={defaults > 0 ? `about ${pct(gh.breakEvenDrop, 1)}` : "–"} /> : null}
              </div>
              <p className="mt-3 text-[13px] text-muted">The loss reaches investors last, and it stays in this pool.</p>
            </Pane>

            <Pane className="border-bad/30">
              <PaneTitle aside="at month 15">2008-style lender, in numbers</PaneTitle>
              <p className={cx("title mb-4 text-xl", oldR.totalLoss > 0 ? "text-bad-fg" : "text-ok")}>{oldVerdict.text}</p>
              <LossStack
                layers={[
                  { name: "Borrowers' collateral", owner: "none", capacity: 0, used: 0 },
                  { name: "First-loss vault", owner: "none", capacity: 0, used: 0 },
                  { name: "Reserve fund", owner: "none", capacity: 0, used: 0 },
                  { name: "Investors", owner: "everything else", capacity: old.loans * old.loanSize, used: oldR.toInvestors, senior: true },
                ]}
                caption={`3% down: the sale covers ${usd(oldR.netSalePerLoan)} of the ${usd(oldR.claimPerLoan)} owed per loan.`}
              />
              <div className="mt-5 border-t border-haze/[0.08] pt-3 text-[15px]">
                <Row k="Gap per defaulted loan" v={usd(oldR.gapPerLoan)} />
                <Row k="Total loss" v={usd(oldR.totalLoss)} strong />
              </div>
              <div className="mt-4">
                <Note tone={bank.wipedOut ? "bad" : "info"}>
                  A bank holding these loans at 30× leverage has {usd(bank.equity)} of equity. {bank.wipedOut ? "This loss wipes it out." : `It keeps ${usd(bank.equityLeft)}.`} Calculation only: the program
                  doesn&apos;t model bank leverage.
                </Note>
              </div>
            </Pane>
          </div>

          <SensitivityTable base={base} tab={tab} />

          <Pane>
            <PaneTitle>Assumptions</PaneTitle>
            <ul className="space-y-2 text-[15px] text-muted">
              {[
                `${s.loans} loans of ${usd(s.loanSize)} on ${usd(s.price)} ${asset}s at ${pct(s.annualRate, 0)}. Defaults happen early, so almost no principal has been repaid.`,
                "Three installments are missed, then the sale takes 12 months: 15 months of interest pile up.",
                `First-loss vault ${usd(s.firstLossVault)} (5%), reserve ${usd(s.reserve)} from origination fees only. Investor loss is shown against senior principal (${usd(senior)}).`,
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-light" aria-hidden />
                  {t}
                </li>
              ))}
              {tab === "vehicle" ? (
                <li className="flex gap-2.5 font-semibold text-warn">
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                  Car figures are an estimate. Damage, theft, cars that can&apos;t be found and used-car discounts are not modeled, so we don&apos;t claim a break-even point for cars.
                </li>
              ) : null}
            </ul>
          </Pane>
        </>
    </div>
  );
}

function SensitivityTable({ base, tab }: { base: StressScenario; tab: Tab }) {
  const costs = [0.1, 0.15, 0.2];
  const rows = costs.map((c) => {
    const at = (d: number) => runStress({ ...base, saleCost: c, priceDrop: d });
    return { c, be: at(0.3).breakEvenDrop, d30: at(0.3), d40: at(0.4), d50: at(0.5) };
  });
  const lose = (r: ReturnType<typeof runStress>) => (r.toInvestors > 0 ? `${usd(r.toInvestors)} (${pct(r.toInvestorsPct, 2)})` : "0");
  return (
    <Pane className="overflow-x-auto">
      <PaneTitle aside={`${base.defaults} defaults out of ${base.loans}`}>
        <span className="inline-flex flex-wrap items-center gap-2">
          {tab === "house" ? "Sale cost is the least certain input" : "Car pool by sale cost"}
          {tab === "vehicle" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[12px] font-semibold text-warn">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Estimate
            </span>
          ) : null}
        </span>
      </PaneTitle>
      <table className="w-full min-w-[560px] text-[15px]">
        <thead>
          <tr className="dense text-left text-[13px] text-muted">
            <th className="px-3 py-2 font-medium" />
            {rows.map((r) => (
              <th key={r.c} className={cx("px-3 py-2 text-right font-medium", r.c === DOC.cost && "text-steel")}>
                Sale cost {pct(r.c, 0)}
                {r.c === DOC.cost ? <span className="block text-[11.5px]">headline</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {tab === "house" ? (
            <tr className="border-t border-haze/[0.07]">
              <td className="px-3 py-2.5 text-muted">Break-even price drop</td>
              {rows.map((r) => (
                <td key={r.c} className={cx("px-3 py-2.5 text-right", r.c === DOC.cost && "bg-accent/10 font-bold")}>
                  about {pct(r.be, 1)}
                </td>
              ))}
            </tr>
          ) : null}
          {[
            { k: "Total loss at a 30% drop", f: (r: (typeof rows)[0]) => usd(r.d30.totalLoss) },
            { k: "Investors lose at 30%", f: (r: (typeof rows)[0]) => lose(r.d30) },
            { k: "Investors lose at 40%", f: (r: (typeof rows)[0]) => lose(r.d40) },
            ...(tab === "vehicle" ? [{ k: "Investors lose at 50%", f: (r: (typeof rows)[0]) => lose(r.d50) }] : []),
          ].map((row) => (
            <tr key={row.k} className="border-t border-haze/[0.07]">
              <td className="px-3 py-2.5 text-muted">{row.k}</td>
              {rows.map((r) => (
                <td key={r.c} className={cx("px-3 py-2.5 text-right", r.c === DOC.cost && "bg-accent/10")}>
                  {row.f(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Pane>
  );
}
