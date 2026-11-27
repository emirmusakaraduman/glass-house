"use client";

import { useMemo, useState } from "react";
import { amortizationSchedule, totalCost, yearlySummary } from "@/lib/finance";
import { pct, usd } from "@/lib/format";
import type { PoolParams } from "@/lib/types";
import { Row, cx } from "./ui";

// "Toplam maliyet kartı": nothing about the cost is hidden. Fee, collateral, interest,
// fee-inclusive nominal and effective annual cost, and the full amortization table.

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
      <h4 className="dense pb-1 pt-1 text-[12.5px] font-semibold uppercase tracking-wider text-muted">{title}</h4>
      <div className="text-[15px]">{children}</div>
    </section>
  );
}

export function TotalCostCard({ price, downPayment, pool }: { price: number; downPayment: number; pool: PoolParams }) {
  const c = useMemo(() => totalCost(price, downPayment, pool), [price, downPayment, pool]);
  return (
    <div className="space-y-3">
      <div>
        <div className="dense text-[13px] text-muted">Monthly installment, fixed</div>
        <div className="display num text-gradient mt-1 text-[44px] drop-shadow-[0_6px_24px_rgb(0_210_255/0.45)]">{usd(c.installment, { cents: true })}</div>
        <p className="mt-1 text-sm text-muted">
          First month: {usd(c.firstMonthInterest, { cents: true })} interest, {usd(c.firstMonthPrincipal, { cents: true })} principal
        </p>
      </div>

      <Group title="The loan">
        <Row k="Loan" v={`${usd(c.loan)} (${pct(c.ltv, 1)} of price)`} />
        <Row k="Term and rate" v={`${pool.termMonths} months at ${pct(pool.annualRate, 0)}`} />
        <Row k="Total interest" v={usd(c.totalInterest)} />
        <Row k="Total of all installments" v={usd(c.totalPaid)} />
      </Group>

      <Group title="At closing">
        <Row k="Down payment" v={usd(c.downPayment)} />
        <Row k={`Origination fee, ${pct(pool.originationFee, 0)} once`} v={usd(c.fee, { cents: true })} />
        <Row k={`Collateral, ${pool.collateralInstallments} installments`} v={usd(c.collateral, { cents: true })} />
        <div className="mt-1 border-t border-white/[0.08] pt-1">
          <Row k="Cash you need at closing" v={usd(c.cashAtClosing, { cents: true })} strong />
        </div>
        <p className="pb-1 text-[13px] text-muted">Collateral is returned when the loan is paid off. Paying off early has no penalty.</p>
      </Group>

      <Group title="Annual cost, fee included">
        <Row k="Nominal annual cost" v={pct(c.nominalAnnualCost, 2)} />
        <Row k="Effective annual cost" v={`about ${pct(c.effectiveAnnualCost, 2)}`} strong />
        <p className="pb-1 text-[13px] text-muted">Calculated from the cash flows (IRR). This is not a legal APR.</p>
      </Group>
    </div>
  );
}

export function AmortizationTable({ loan, pool, heading = true }: { loan: number; pool: PoolParams; heading?: boolean }) {
  const [monthly, setMonthly] = useState(false);
  const rows = useMemo(() => amortizationSchedule(loan, pool.annualRate, pool.termMonths), [loan, pool]);
  const years = useMemo(() => yearlySummary(rows), [rows]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {heading ? <h3 className="title text-lg">Amortization</h3> : <span />}
        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm" role="group" aria-label="Table period">
          {[
            { v: false, l: "By year" },
            { v: true, l: "By month" },
          ].map((o) => (
            <button key={o.l} onClick={() => setMonthly(o.v)} aria-pressed={monthly === o.v} className={cx("rounded-full px-3.5 py-1 font-semibold transition-colors", monthly === o.v ? "fill-accent" : "text-muted hover:text-ink")}>
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-[12px] border border-white/10">
        <table className="w-full min-w-[480px] text-[14px]">
          <thead className="sticky top-0 bg-night">
            <tr className="dense text-left text-[13px] text-muted">
              <th className="px-3 py-2 font-medium">{monthly ? "Month" : "Year"}</th>
              <th className="px-3 py-2 text-right font-medium">Paid</th>
              <th className="px-3 py-2 text-right font-medium">Interest</th>
              <th className="px-3 py-2 text-right font-medium">Principal</th>
              <th className="px-3 py-2 text-right font-medium">Balance after</th>
            </tr>
          </thead>
          <tbody className="num">
            {monthly
              ? rows.map((r) => (
                  <tr key={r.month} className="border-t border-white/[0.06]">
                    <td className="px-3 py-1.5">{r.month}</td>
                    <td className="px-3 py-1.5 text-right">{usd(r.payment, { cents: true })}</td>
                    <td className="px-3 py-1.5 text-right">{usd(r.interest, { cents: true })}</td>
                    <td className="px-3 py-1.5 text-right">{usd(r.principal, { cents: true })}</td>
                    <td className="px-3 py-1.5 text-right">{usd(r.balance, { cents: true })}</td>
                  </tr>
                ))
              : years.map((y) => (
                  <tr key={y.year} className="border-t border-white/[0.06]">
                    <td className="px-3 py-1.5">{y.year}</td>
                    <td className="px-3 py-1.5 text-right">{usd(y.paid)}</td>
                    <td className="px-3 py-1.5 text-right">{usd(y.interest)}</td>
                    <td className="px-3 py-1.5 text-right">{usd(y.principal)}</td>
                    <td className="px-3 py-1.5 text-right">{usd(y.endBalance)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
