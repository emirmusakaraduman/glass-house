"use client";

import { AlertTriangle, Car, ExternalLink, Flag, Home, Repeat, Users, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, TICK, TOOLTIP_STYLE } from "@/components/chartTheme";
import { GlassStack3D } from "@/components/GlassStack3D";
import { LoanTable, isCrankable, loanLtv } from "@/components/LoanBits";
import { PoolLossStack, poolLayers } from "@/components/PoolLayers";
import { useAction, useChainQuery, useGlassHouse } from "@/components/providers/ClientProvider";
import { Button, ErrorText, GlassCard, IconBadge, KpiCard, LoadError, Note, Pane, PaneTitle, Segmented, Skeleton, Stat, TxNote, cx } from "@/components/ui";
import { DATA_SOURCE, LIVE_STATUSES, computeMetrics, explorerAddress, loanLabel } from "@/lib/chain";
import { num, pct, usd } from "@/lib/format";
import { POOLS } from "@/lib/pools";
import type { LoanStatus, PoolId } from "@/lib/types";

type Filter = "all" | PoolId;
const STATUS_GROUPS: { label: string; statuses: LoanStatus[] }[] = [
  { label: "All", statuses: [] },
  { label: "Active", statuses: ["Active"] },
  { label: "Late", statuses: ["Late1", "Late2"] },
  { label: "Defaulted", statuses: ["Defaulted", "Recovered"] },
  { label: "In progress", statuses: ["Pending", "Funded"] },
  { label: "Closed", statuses: ["PaidOff", "Rejected", "Cancelled"] },
];
const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? "";

export default function TransparencyPage() {
  const { client } = useGlassHouse();
  const [pool, setPool] = useState<Filter>("all");
  const [group, setGroup] = useState(0);
  const crank = useAction();
  const { data, error } = useChainQuery(async (c) => {
    const [pools, loans] = await Promise.all([c.getPools(), c.getLoans()]);
    return { pools, loans };
  }, []);

  // KPIs straight from the data.
  const kpi = useMemo(() => {
    if (!data) return null;
    const onChain = data.loans.filter((l) => !["Rejected", "Cancelled"].includes(l.status));
    const wallets = new Set(data.loans.filter((l) => LIVE_STATUSES.includes(l.status)).map((l) => l.borrower));
    // Recorded payments when the client has a history (mock). The chain client has no indexer and returns no
    // events, so there the total is the loan's own counters: paid installments times the installment.
    const repaid = data.loans.reduce((sum, l) => {
      const events = l.events.filter((e) => e.kind === "repaid");
      return sum + (events.length > 0 ? events.reduce((s, e) => s + (e.amount ?? 0), 0) : l.paidInstallments * l.installment);
    }, 0);
    return { onChain: onChain.length, wallets: wallets.size, repaid };
  }, [data]);

  const loans = useMemo(() => {
    if (!data) return [];
    const g = STATUS_GROUPS[group].statuses;
    return data.loans
      .filter((l) => (pool === "all" || l.poolId === pool) && (g.length === 0 || g.includes(l.status)))
      .sort((a, b) => (a.poolId === b.poolId ? b.seq - a.seq : a.poolId.localeCompare(b.poolId)));
  }, [data, pool, group]);

  const ltvBuckets = useMemo(() => {
    const live = (data?.loans ?? []).filter((l) => ["Active", "Late1", "Late2", "Defaulted", "Funded"].includes(l.status) && (pool === "all" || l.poolId === pool));
    const edges = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
    return edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const inBucket = live.filter((l) => {
        const v = loanLtv(l);
        return v >= lo && (i === edges.length - 2 ? v <= hi + 1e-9 : v < hi);
      });
      return { label: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, home: inBucket.filter((l) => l.poolId === "house").length, car: inBucket.filter((l) => l.poolId === "vehicle").length };
    });
  }, [data, pool]);

  const now = Date.now();
  const crankable = (data?.loans ?? []).filter((l) => isCrankable(l, now));
  const house = data?.pools.find((p) => p.params.id === "house");
  const houseM = house && data ? computeMetrics(house, data.loans) : null;

  return (
    <div className="space-y-8">
      <LoadError error={error} what="the loans" />
      {/* ------------------------------------------------------------ hero */}
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          {kpi ? (
            <>
              <KpiCard label="Loans on-chain" value={num(kpi.onChain)} hint="Every loan except rejected or cancelled applications" icon={Repeat} />
              <KpiCard label="Active borrower wallets" value={num(kpi.wallets)} hint="pseudonymous, one new wallet per loan" icon={Users} />
              <KpiCard label="Repaid so far" value={usd(kpi.repaid, { compact: kpi.repaid >= 100_000 })} hint="Sum of every recorded installment payment" icon={Wallet} />
            </>
          ) : (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-[104px] rounded-[20px]" />)
          )}
          {DATA_SOURCE === "chain" && PROGRAM_ID ? (
            <a href={explorerAddress(PROGRAM_ID)} target="_blank" rel="noreferrer" className="fill-accent inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold">
              Open in Solana Explorer <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="quiet" disabled aria-describedby="explorer-note">
                Open in Solana Explorer <ExternalLink className="h-4 w-4" aria-hidden />
              </Button>
              <span id="explorer-note" className="text-[13px] text-muted">
                Available on devnet. This demo runs on mock data.
              </span>
            </div>
          )}
        </div>

        <GlassCard variant="highlight" className="overflow-hidden">
          <PaneTitle aside={houseM ? `Share price ${houseM.sharePrice.toFixed(4)}` : undefined}>Home pool, who pays first</PaneTitle>
          {house && houseM ? <GlassStack3D layers={poolLayers(house, houseM)} /> : <Skeleton className="h-[320px]" />}
        </GlassCard>
      </div>

      {/* ------------------------------------------------------------ pool health */}
      <div className="grid gap-6 lg:grid-cols-2">
        {(data?.pools ?? []).map((p) => {
          const m = computeMetrics(p, data!.loans);
          const Icon = p.params.id === "house" ? Home : Car;
          return (
            <Pane key={p.params.id}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="title inline-flex items-center gap-2.5 text-lg">
                  <IconBadge icon={Icon} size="sm" tone={p.params.id === "vehicle" ? "indigo" : "accent"} />
                  {p.params.name}
                </h2>
                <span
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold",
                    m.brakeOn ? "border-bad/45 bg-bad/[0.14] text-bad-fg" : "border-ok/35 bg-ok/10 text-ok",
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  {m.brakeOn ? "Lending paused" : "Lending open"}
                </span>
              </div>
              <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat label="Lent out" value={usd(p.outstandingPrincipal, { compact: true })} />
                <Stat label="Late or defaulted" value={pct(m.delinquencyRatio, 1)} tone={m.delinquencyRatio > p.params.brakeDelinquency ? "bad" : m.delinquencyRatio > 0 ? "warn" : "ok"} />
                <Stat label="First-loss cover" value={pct(p.outstandingPrincipal ? p.firstLossVault / p.outstandingPrincipal : 0, 2)} hint={`min ${pct(p.params.firstLossTarget, 0)}`} />
                <Stat label="Reserve" value={pct(p.outstandingPrincipal ? p.reserve / p.outstandingPrincipal : 0, 2)} hint={`brake below ${pct(p.params.brakeReserveMin, Number.isInteger(p.params.brakeReserveMin * 100) ? 0 : 2)}`} />
              </div>
              <PoolLossStack pool={p} metrics={m} />
              {m.brakeReason ? (
                <div className="mt-4">
                  <Note tone="bad">{m.brakeReason}. No new loans until it recovers.</Note>
                </div>
              ) : null}
            </Pane>
          );
        })}
      </div>

      {/* ------------------------------------------------------------ overdue */}
      {crankable.length > 0 ? (
        <section aria-labelledby="overdue-title" className="pane border-bad/40 bg-[linear-gradient(135deg,rgb(248_113_113/0.14),rgb(248_113_113/0.04))] p-5 hover:border-bad/60 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="overdue-title" className="title inline-flex items-center gap-2.5 text-lg">
              <IconBadge icon={AlertTriangle} size="sm" tone="bad" />
              Overdue right now
            </h2>
            <span className="text-sm text-muted">Any wallet can send this transaction</span>
          </div>
          <ul className="space-y-2">
            {crankable.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-bad/25 bg-bad/[0.06] px-3.5 py-2.5">
                <span>
                  <span className="num font-bold">{loanLabel(l)}</span> <span className="text-muted">{l.poolId === "house" ? "Home" : "Car"}, past due and grace</span>
                </span>
                <Button size="sm" variant="danger" disabled={crank.pending} onClick={() => crank.run(() => client.crankLoan(l.key), { success: (r) => ({ title: `${loanLabel(l)}: ${r.message}`, tone: r.changed ? "ok" : "info" }), failure: "Check failed" })}>
                  <Flag className="h-4 w-4" aria-hidden />
                  Flag {loanLabel(l)}
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <ErrorText>{crank.error}</ErrorText>
            {crank.last ? <TxNote {...crank.last} /> : null}
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------------ every loan */}
      <section aria-labelledby="loans-title">
        <h2 id="loans-title" className="title mb-4 text-2xl">
          Every loan
        </h2>
        <Pane className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3 px-1">
            <Segmented
              label="Pool"
              value={pool}
              onChange={setPool}
              options={[
                { value: "all", label: "Both" },
                { value: "house", label: "Home", icon: Home },
                { value: "vehicle", label: "Car", icon: Car },
              ]}
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {STATUS_GROUPS.map((g, i) => (
                <button
                  key={g.label}
                  onClick={() => setGroup(i)}
                  aria-pressed={group === i}
                  className={cx("rounded-full border px-3 py-1 text-sm font-medium", group === i ? "fill-accent border-transparent" : "border-haze/12 bg-haze/[0.04] text-muted hover:border-accent/50 hover:text-ink")}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          {data ? (
            loans.length ? (
              <LoanTable loans={loans} rowLinks stickyHeader mobileCards />
            ) : (
              <p className="px-2 py-6 text-muted">No loans match these filters.</p>
            )
          ) : (
            <Skeleton className="h-60" />
          )}
        </Pane>
      </section>

      {/* ------------------------------------------------------------ LTV */}
      <Pane className="lg:max-w-[640px]">
        <PaneTitle aside="loan / min(price, appraisal)">Loan-to-value</PaneTitle>
        <p className="sr-only">
          Loans by loan-to-value: {ltvBuckets.map((b) => `${b.label}: ${b.home} home, ${b.car} car`).join("; ")}.
        </p>
        <div className="h-[240px]" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ltvBuckets} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tickLine={false} tick={TICK} axisLine={{ stroke: CHART.axis }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} />
              <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: CHART.cursor }} />
              <Bar dataKey="home" name="Home loans" stackId="a" fill={CHART.home} />
              <Bar dataKey="car" name="Car loans" stackId="a" fill={CHART.car} radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-chart-home" aria-hidden /> Home loans (cap {pct(POOLS.house.maxLtv, 0)})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-indigo" aria-hidden /> Car loans (cap {pct(POOLS.vehicle.maxLtv, 0)})
          </span>
        </p>
      </Pane>
    </div>
  );
}
