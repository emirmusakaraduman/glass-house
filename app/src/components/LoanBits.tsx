"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, MapPin } from "lucide-react";
import { loanLabel } from "@/lib/chain";
import { valueBand } from "@/lib/finance";
import { bandLabel, pct, relTime, usd } from "@/lib/format";
import { POOLS } from "@/lib/pools";
import type { Loan, LoanStatus } from "@/lib/types";
import { cx } from "./ui";

// Dark-theme pills: a tinted fill plus a dot, so the state reads without relying on color alone.
const STATUS: Record<LoanStatus, { label: string; cls: string }> = {
  Pending: { label: "Pending", cls: "border-accent-light/35 bg-accent/10 text-steel" },
  Rejected: { label: "Rejected", cls: "border-white/15 bg-white/[0.04] text-muted" },
  Funded: { label: "In escrow", cls: "border-indigo/35 bg-indigo/10 text-indigo" },
  Cancelled: { label: "Cancelled", cls: "border-white/15 bg-white/[0.04] text-muted" },
  Active: { label: "Active", cls: "border-ok/35 bg-ok/10 text-ok" },
  Late1: { label: "Late, 1 missed", cls: "border-warn/40 bg-warn/10 text-warn" },
  Late2: { label: "Late, 2 missed", cls: "border-warn/60 bg-warn/[0.16] text-warn" },
  Defaulted: { label: "Defaulted", cls: "border-bad/50 bg-bad/[0.14] text-bad-fg" },
  Recovered: { label: "Recovered", cls: "border-white/15 bg-white/[0.04] text-muted" },
  PaidOff: { label: "Paid off", cls: "border-ok/35 bg-ok/10 text-ok" },
};

export function StatusBadge({ status, approved }: { status: LoanStatus; approved?: boolean }) {
  const s = status === "Pending" && approved ? { label: "Approved", cls: "border-accent-light/50 bg-accent/15 text-steel" } : STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-semibold", s.cls)}>
      {status === "Late1" || status === "Late2" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {s.label}
    </span>
  );
}

export function loanLtv(l: Loan) {
  const value = Math.min(l.price, l.appraisal ?? l.price);
  return value > 0 ? l.principal / value : 0;
}

export function loanBand(l: Loan) {
  const b = valueBand(Math.min(l.price, l.appraisal ?? l.price), POOLS[l.poolId].valueBand);
  return bandLabel(b.lo, b.hi);
}

/** Overdue past grace but not processed yet: anyone can crank it now. */
export function isCrankable(l: Loan, now = Date.now()) {
  if (!["Active", "Late1", "Late2"].includes(l.status) || l.nextDueAt === null) return false;
  const p = POOLS[l.poolId];
  const overdue = now - l.nextDueAt - p.graceSeconds * 1000;
  if (overdue < 0) return false;
  return Math.floor(overdue / (p.periodSeconds * 1000)) + 1 > l.missedInstallments;
}

function NextDue({ l, now }: { l: Loan; now: number }) {
  if (l.nextDueAt === null) return <span className="text-muted">–</span>;
  if (isCrankable(l, now)) return <span className="font-semibold text-bad-fg">Overdue, anyone can flag it</span>;
  return <span className={l.nextDueAt < now ? "text-warn" : "text-muted"}>{relTime(l.nextDueAt, now)}</span>;
}

/**
 * Loans as a table. Options:
 * - `rowLinks`: the whole row opens the loan (the id stays a real link for keyboard and screen readers).
 * - `stickyHeader`: the table scrolls inside a tall box with the header pinned.
 * - `mobileCards`: below sm, a list of cards replaces the table.
 */
export function LoanTable({ loans, compact, rowLinks, stickyHeader, mobileCards }: { loans: Loan[]; compact?: boolean; rowLinks?: boolean; stickyHeader?: boolean; mobileCards?: boolean }) {
  const now = Date.now();
  const router = useRouter();
  return (
    <>
      {mobileCards ? (
        <ul className="space-y-2 sm:hidden">
          {loans.map((l) => (
            <li key={l.key}>
              <Link href={`/loans/${l.key}`} className="block rounded-[12px] border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:border-accent/40">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="num font-bold text-steel">{loanLabel(l)}</span>
                    <span className="ml-2 text-[13px] text-muted">{l.poolId === "house" ? "Home" : "Car"}</span>
                  </span>
                  <StatusBadge status={l.status} approved={l.appraisal !== null} />
                </div>
                <div className="mt-1 inline-flex items-center gap-1 text-[13px] text-muted">
                  <MapPin className="h-3 w-3" aria-hidden />
                  {l.region} · <span className="num">{loanBand(l)}</span>
                </div>
                <div className="num mt-2 grid grid-cols-3 gap-2 text-[13px]">
                  <span>
                    <span className="block text-muted">LTV</span>
                    {pct(loanLtv(l), 1)}
                  </span>
                  <span>
                    <span className="block text-muted">Remaining</span>
                    {usd(l.remainingPrincipal)}
                  </span>
                  <span>
                    <span className="block text-muted">Next due</span>
                    <NextDue l={l} now={now} />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    <div className={cx("-mx-2 overflow-x-auto", stickyHeader && "max-h-[560px] overflow-y-auto", mobileCards && "hidden sm:block")}>
      <table className="w-full min-w-[720px] border-collapse text-[15px]">
        <thead className={cx(stickyHeader && "sticky top-0 z-10 bg-night/95 backdrop-blur")}>
          <tr className="dense text-left text-[13px] text-muted">
            <th className="px-2 py-2 font-medium">Loan</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Region</th>
            <th className="px-2 py-2 font-medium">Value band</th>
            <th className="px-2 py-2 text-right font-medium">LTV</th>
            <th className="px-2 py-2 text-right font-medium">Rate</th>
            <th className="px-2 py-2 text-right font-medium">Remaining</th>
            {!compact ? <th className="px-2 py-2 text-right font-medium">Provision</th> : null}
            <th className="px-2 py-2 font-medium">Next due</th>
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => (
            <tr
              key={l.key}
              className={cx("whitespace-nowrap border-t border-white/[0.07] transition-colors hover:bg-white/[0.04]", rowLinks && "cursor-pointer")}
              onClick={
                rowLinks
                  ? (e) => {
                      if ((e.target as HTMLElement).closest("a,button")) return;
                      router.push(`/loans/${l.key}`);
                    }
                  : undefined
              }
            >
              <td className="px-2 py-2.5">
                <Link href={`/loans/${l.key}`} className="font-semibold text-steel underline-offset-2 hover:underline">
                  {loanLabel(l)}
                </Link>
                <span className="ml-2 text-[13px] text-muted">{l.poolId === "house" ? "Home" : "Car"}</span>
              </td>
              <td className="px-2 py-2.5">
                <StatusBadge status={l.status} approved={l.appraisal !== null} />
              </td>
              <td className="px-2 py-2.5">{l.region}</td>
              <td className="num px-2 py-2.5">{loanBand(l)}</td>
              <td className="num px-2 py-2.5 text-right">{pct(loanLtv(l), 1)}</td>
              <td className="num px-2 py-2.5 text-right">{pct(l.annualRate, 0)}</td>
              <td className="num px-2 py-2.5 text-right">{usd(l.remainingPrincipal)}</td>
              {!compact ? <td className={cx("num px-2 py-2.5 text-right", l.provision > 0 && "text-bad-fg")}>{l.provision > 0 ? usd(l.provision) : "–"}</td> : null}
              <td className="px-2 py-2.5 text-[14px]">
                <NextDue l={l} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
