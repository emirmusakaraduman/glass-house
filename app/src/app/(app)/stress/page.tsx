"use client";

import { AlertTriangle, Building2, Car, Home, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { LossStack } from "@/components/LossStack";
import { Button, IconBadge, Note, Pane, PaneTitle, Row, Segmented, cx } from "@/components/ui";
import { pct, usd } from "@/lib/format";
import { HOUSE_STRESS_BASE, VEHICLE_STRESS_BASE, lender2008, leveragedBank, runStress, type StressScenario } from "@/lib/stress";

type Tab = "house" | "vehicle";

// The doc's headline scenario: 30% price drop, 20 defaults out of 100, 15% sale and legal costs.
const DOC = { drop: 0.3, defaults: 20, cost: 0.15 };

export default function StressPage() {
  const [tab, setTab] = useState<Tab>("house");
  const base = tab === "house" ? HOUSE_STRESS_BASE : VEHICLE_STRESS_BASE;
  const [drop, setDrop] = useState(DOC.drop);
  const [defaults, setDefaults] = useState(DOC.defaults);
  const [cost, setCost] = useState(DOC.cost);

  const s: StressScenario = useMemo(() => ({ ...base, priceDrop: drop, defaults, saleCost: cost }), [base, drop, defaults, cost]);
  const gh = useMemo(() => runStress(s), [s]);
  const old = useMemo(() => lender2008(s), [s]);
  const oldR = useMemo(() => runStress(old), [old]);
  const bank = useMemo(() => leveragedBank(old), [old]);
  const senior = s.loans * s.loanSize - s.firstLossVault;
  const asset = tab === "house" ? "home" : "car";
  const atDoc = drop === DOC.drop && defaults === DOC.defaults && cost === DOC.cost;
  const resetToDoc = () => {
    setDrop(DOC.drop);
    setDefaults(DOC.defaults);
    setCost(DOC.cost);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Pool"
            value={tab}
            onChange={(v) => {
              setTab(v);
              setDrop(DOC.drop);
            }}
            options={[
              { value: "house", label: "Home pool", icon: Home },
              { value: "vehicle", label: "Car pool", icon: Car },
            ]}
          />
          {tab === "vehicle" ? <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[13px] font-semibold text-warn"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />Estimate</span> : null}
        </div>
        <p className="max-w-[60ch] text-sm text-muted">{`Take ${s.loans} ${asset} loans, let some default, drop prices, and follow the loss through every layer. Then run the same crash against a 2008-style lender.`}</p>
      </div>

      {tab === "vehicle" ? (
        <Note tone="warn">
          Car figures are an estimate. Damage, theft, cars that can&apos;t be found and used-car discounts are not modeled, so we don&apos;t claim a break-even point for cars.
        </Note>
      ) : null}

      {/* ------------------------------------------------------------ sliders */}
      <section aria-labelledby="scenario-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="scenario-title" className="title text-2xl">
            Scenario
          </h2>
          <Button variant="quiet" size="sm" onClick={resetToDoc} disabled={atDoc}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reset to the doc&apos;s scenario
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <SliderCard label={`${asset === "home" ? "Home" : "Car"} price drop at sale`} value={drop} min={0} max={0.6} step={0.01} display={pct(drop, 0)} onChange={setDrop} />
          <SliderCard label="Loans that default" value={defaults} min={0} max={50} step={1} display={`${defaults}`} unit={`of ${s.loans}`} onChange={setDefaults} />
          <SliderCard label="Sale and legal costs" value={cost} min={0.05} max={0.25} step={0.01} display={pct(cost, 0)} onChange={setCost} />
        </div>
      </section>

      {/* ------------------------------------------------------------ results */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Pane className={cx(gh.toInvestors > 0 ? "border-bad/35" : "border-ok/30")}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="title inline-flex items-center gap-2.5 text-lg">
              <IconBadge icon={ShieldCheck} size="sm" /> GlassHouse
            </h2>
            <span className="text-sm text-muted">
              max LTV {pct(s.loanSize / s.price, 0)}, first-loss {usd(s.firstLossVault, { compact: true })}
            </span>
          </div>
          <p className={cx("display mb-5 mt-3 text-[32px] sm:text-[38px]", gh.toInvestors > 0 ? "text-bad-fg" : "text-ok")} aria-live="polite">
            {gh.toInvestors > 0 ? `Investors lose ${pct(gh.toInvestorsPct, 2)}` : "Investors lose nothing"}
          </p>
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
          <div className="mt-5 border-t border-white/[0.08] pt-3 text-[15px]">
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
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 className="title inline-flex items-center gap-2.5 text-lg">
              <IconBadge icon={Building2} size="sm" tone="bad" /> 2008-style lender
            </h2>
            <span className="text-sm text-muted">same program, LTV 97%, no first-loss, no reserve</span>
          </div>
          <p className={cx("display mb-5 mt-3 text-[32px] sm:text-[38px]", oldR.totalLoss > 0 ? "text-bad-fg" : "text-ok")}>
            {oldR.totalLoss > 0 ? `Investors lose ${pct(oldR.toInvestorsPct, 1)}` : "Investors lose nothing"}
          </p>
          <LossStack
            layers={[
              { name: "Borrowers' collateral", owner: "none", capacity: 0, used: 0 },
              { name: "First-loss vault", owner: "none", capacity: 0, used: 0 },
              { name: "Reserve fund", owner: "none", capacity: 0, used: 0 },
              { name: "Investors", owner: "everything else", capacity: old.loans * old.loanSize, used: oldR.toInvestors, senior: true },
            ]}
            caption={`3% down: the sale covers ${usd(oldR.netSalePerLoan)} of the ${usd(oldR.claimPerLoan)} owed per loan.`}
          />
          <div className="mt-5 border-t border-white/[0.08] pt-3 text-[15px]">
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
          {tab === "vehicle" ? <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[12px] font-semibold text-warn"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />Estimate</span> : null}
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
            <tr className="border-t border-white/[0.07]">
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
            <tr key={row.k} className="border-t border-white/[0.07]">
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

function SliderCard({
  label,
  value,
  min,
  max,
  step,
  display,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  unit?: string;
  onChange: (v: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="pane block p-5">
      <span className="dense block text-[13px] text-muted">{label}</span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className="display num text-gradient text-[40px]">{display}</span>
        {unit ? <span className="text-sm text-muted">{unit}</span> : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="gh-range mt-3"
        style={{ ["--fill" as string]: `${fill}%` }}
        aria-valuetext={unit ? `${display} ${unit}` : display}
      />
      <span className="mt-1 flex justify-between text-[12px] text-muted" aria-hidden>
        <span>{step < 1 ? pct(min, 0) : min}</span>
        <span>{step < 1 ? pct(max, 0) : max}</span>
      </span>
    </label>
  );
}
