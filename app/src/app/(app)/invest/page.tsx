"use client";

import { AlertTriangle, ArrowRight, Car, ExternalLink, Home, Landmark, Layers, ShieldCheck, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Donut, MiniSparkline } from "@/components/charts";
import { LoanTable } from "@/components/LoanBits";
import { PoolLossStack } from "@/components/PoolLayers";
import { SharePriceChart } from "@/components/SharePriceChart";
import { useAction, useChainQuery, useGlassHouse } from "@/components/providers/ClientProvider";
import {
  Button,
  ButtonLink,
  ErrorText,
  Field,
  GlassCard,
  IconBadge,
  KpiCard,
  LoadError,
  Modal,
  MoneyInput,
  Note,
  Pane,
  PaneTitle,
  Segmented,
  Skeleton,
  Stat,
  TextInput,
  TxNote,
  cx,
} from "@/components/ui";
import { DATA_SOURCE, computeMetrics, explorerAddress } from "@/lib/chain";
import { num, pct, shortAddr, usd } from "@/lib/format";
import { POOLS } from "@/lib/pools";
import type { PoolId, PoolMetrics, PoolState, SharePricePoint } from "@/lib/types";

const DAY = 86_400_000;
const RANGES = { "1D": DAY, "1W": 7 * DAY, "1M": 30 * DAY, All: Infinity } as const;
type Range = keyof typeof RANGES;
const POOL_ICON = { house: Home, vehicle: Car } as const;
const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ?? "";

export default function InvestPage() {
  const { client } = useGlassHouse();
  const [poolId, setPoolId] = useState<PoolId>("house");
  const [range, setRange] = useState<Range>("All");
  const [investIn, setInvestIn] = useState<PoolId | null>(null);
  const [openSeq, setOpenSeq] = useState(0);

  const { data, error } = useChainQuery(async (c) => {
    const [pools, loans, house, vehicle, posHouse, posVehicle] = await Promise.all([
      c.getPools(),
      c.getLoans(),
      c.getSharePriceHistory("house"),
      c.getSharePriceHistory("vehicle"),
      c.getPosition("house", c.actor),
      c.getPosition("vehicle", c.actor),
    ]);
    return { pools, loans, history: { house, vehicle }, position: { house: posHouse, vehicle: posVehicle } };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const byId = Object.fromEntries(data.pools.map((p) => [p.params.id, p])) as Record<PoolId, PoolState>;
    const metrics = { house: computeMetrics(byId.house, data.loans), vehicle: computeMetrics(byId.vehicle, data.loans) } as Record<PoolId, PoolMetrics>;
    return { byId, metrics };
  }, [data]);

  const openInvest = (id: PoolId) => {
    setInvestIn(id);
    setOpenSeq((n) => n + 1);
  };

  const pool = view?.byId[poolId] ?? null;
  const m = view?.metrics[poolId] ?? null;
  const loans = data?.loans.filter((l) => l.poolId === poolId && !["Rejected", "Cancelled"].includes(l.status)).sort((a, b) => b.seq - a.seq) ?? [];

  return (
    <div className="space-y-8">
      <LoadError error={error} what="the pools" />
      {/* ------------------------------------------------------------ KPIs (both pools) */}
      <Kpis data={data} view={view} />

      {/* ------------------------------------------------------------ growth + split */}
      <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Pane>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[14rem] flex-1">
              <h2 className="title text-lg">Pool growth</h2>
              <p className="text-sm text-muted">Share price in USDC. Interest stays in the pool, so it steps up on payment days.</p>
            </div>
            <Segmented
              label="Range"
              value={range}
              onChange={setRange}
              options={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: r }))}
            />
          </div>
          <div className="mb-4">
            <Segmented
              label="Pool"
              value={poolId}
              onChange={setPoolId}
              options={[
                { value: "house", label: "Home" },
                { value: "vehicle", label: "Car" },
              ]}
            />
          </div>
          {data ? <GrowthChart points={data.history[poolId]} range={range} /> : <Skeleton className="h-[260px]" />}
        </Pane>

        <Pane className="flex flex-col">
          <PaneTitle aside="principal lent out">Portfolio split</PaneTitle>
          {view ? (
            <PortfolioSplit house={view.byId.house.outstandingPrincipal} vehicle={view.byId.vehicle.outstandingPrincipal} />
          ) : (
            <Skeleton className="mx-auto h-[200px] w-[200px] rounded-full" />
          )}
        </Pane>
      </div>

      {/* ------------------------------------------------------------ pools */}
      <section aria-labelledby="pools-title">
        <h2 id="pools-title" className="title mb-4 text-2xl">
          Pools
        </h2>
        <ul className="space-y-3">
          {(["house", "vehicle"] as PoolId[]).map((id) =>
            view ? (
              <PoolRow key={id} pool={view.byId[id]} m={view.metrics[id]} onInvest={() => openInvest(id)} />
            ) : (
              <li key={id}>
                <Skeleton className="h-[84px]" />
              </li>
            ),
          )}
        </ul>
      </section>

      {/* ------------------------------------------------------------ on-chain band */}
      <GlassCard variant="highlight" className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <IconBadge icon={ShieldCheck} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            Every transaction is recorded on-chain
            {DATA_SOURCE === "mock" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[12px] font-semibold text-warn">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Simulated in this demo
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-sm text-muted">Anyone can check every loan&apos;s payments and status.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {DATA_SOURCE === "chain" && PROGRAM_ID ? (
            <a href={explorerAddress(PROGRAM_ID)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-steel underline-offset-2 hover:text-ink hover:underline">
              Program on Explorer <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : null}
          <ButtonLink href="/transparency" variant="quiet">
            See every loan <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>
      </GlassCard>

      {/* ------------------------------------------------------------ selected pool in detail */}
      <section aria-labelledby="detail-title" className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="detail-title" className="title text-2xl">
            {POOLS[poolId].name} in detail
          </h2>
          <Segmented
            label="Pool in detail"
            value={poolId}
            onChange={setPoolId}
            options={[
              { value: "house", label: "Home pool" },
              { value: "vehicle", label: "Car pool" },
            ]}
          />
        </div>

        {m?.brakeOn ? <Note tone="bad">New lending is paused. {m.brakeReason}.</Note> : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Pane>
            <PaneTitle>Who pays before you do</PaneTitle>
            {pool && m ? <PoolLossStack pool={pool} metrics={m} /> : <Skeleton className="h-48" />}
          </Pane>
          <div className="space-y-6">
            <PositionCard poolId={poolId} position={data?.position[poolId] ?? null} onInvest={() => openInvest(poolId)} actor={client.actor} />
            <WithdrawalLine pool={pool} />
          </div>
        </div>

        <div>
          <h3 className="title mb-4 text-xl">Loans in this pool</h3>
          <Pane className="p-3 sm:p-4">
            {data ? (
              loans.length ? (
                <LoanTable loans={loans} rowLinks mobileCards />
              ) : (
                <p className="px-2 py-6 text-muted">No loans in this pool yet. Applications from the listing finder land here once they are signed.</p>
              )
            ) : (
              <Skeleton className="h-60" />
            )}
          </Pane>
          <p className="mt-3 max-w-[80ch] text-[13px] text-muted">
            Known limit: interest enters the share price when installments are paid, so depositing right before a payment day and leaving right after captures a little of it. A small entry and exit fee
            covers this in the hackathon version; daily accrual is future work.
          </p>
        </div>
      </section>

      <Modal
        open={investIn !== null}
        onClose={() => setInvestIn(null)}
        title={investIn ? `Invest in the ${POOLS[investIn].name.toLowerCase()}` : "Invest"}
        description="Shares are minted at the share price of this moment."
      >
        {investIn && view ? <DepositForm key={openSeq} poolId={investIn} sharePrice={view.metrics[investIn].sharePrice} /> : null}
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------------------- KPIs

function change24m(points: SharePricePoint[], now = Date.now()) {
  const from = points.find((p) => p.at >= now - 730 * DAY) ?? points[0];
  const last = points.at(-1);
  return from && last ? last.price / from.price - 1 : null;
}

function Kpis({
  data,
  view,
}: {
  data: { history: Record<PoolId, SharePricePoint[]> } | null;
  view: { byId: Record<PoolId, PoolState>; metrics: Record<PoolId, PoolMetrics> } | null;
}) {
  if (!data || !view) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[118px] rounded-[20px]" />
        ))}
      </div>
    );
  }
  const { metrics } = view;
  const houseSeries = data.history.house.map((p) => p.price);
  const carSeries = data.history.vehicle.map((p) => p.price);
  const totalNav = metrics.house.seniorNav + metrics.vehicle.seniorNav;
  const active = metrics.house.loansActive + metrics.vehicle.loansActive;
  const late = metrics.house.loansLate + metrics.house.loansDefaulted + metrics.vehicle.loansLate + metrics.vehicle.loansDefaulted;
  const growth = change24m(data.history.house);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Total pool value"
        value={usd(totalNav, { compact: true })}
        hint="Senior NAV, home + car"
        aside={<MiniSparkline values={houseSeries} label="Home pool share price, last 24 months" />}
      />
      <KpiCard
        label="Active loans"
        value={num(active)}
        hint={late > 0 ? `${late} late or defaulted` : "None late or defaulted"}
        aside={<MiniSparkline values={carSeries} tone="car" label="Car pool share price, last 24 months" />}
      />
      <KpiCard
        label="Share price, home pool"
        value={metrics.house.sharePrice.toFixed(4)}
        tone={growth !== null && growth < 0 ? "bad" : undefined}
        hint={growth !== null ? `${growth >= 0 ? "+" : ""}${pct(growth, 2)} in 24 months` : undefined}
        aside={<MiniSparkline values={houseSeries} label="Home pool share price, last 24 months" />}
      />
      <KpiCard
        label="Target yield, gross"
        value={
          <span className="text-[22px] leading-tight">
            ~{pct(POOLS.house.targetYield, 0)} <span className="text-[14px] font-semibold text-muted">home</span>, ~{pct(POOLS.vehicle.targetYield, 0)}{" "}
            <span className="text-[14px] font-semibold text-muted">car</span>
          </span>
        }
        hint="Estimate, not a promise"
        aside={<MiniSparkline values={carSeries} tone="car" label="Car pool share price, last 24 months" />}
      />
    </div>
  );
}

// -------------------------------------------------------------------------- growth chart

function GrowthChart({ points, range }: { points: SharePricePoint[]; range: Range }) {
  const now = Date.now();
  const inRange = RANGES[range] === Infinity ? points : points.filter((p) => p.at >= now - RANGES[range]);
  if (inRange.length < 2) {
    return (
      <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-white/12 text-center text-sm text-muted">
        <TrendingUp className="h-5 w-5" aria-hidden />
        Not enough history for this range yet.
      </div>
    );
  }
  const first = inRange[0].price;
  const last = inRange[inRange.length - 1].price;
  const change = last / first - 1;
  return (
    <div>
      <p className="mb-2 text-sm">
        <span className="num text-lg font-extrabold">{last.toFixed(4)}</span>{" "}
        <span className={cx("num font-semibold", change >= 0 ? "text-ok" : "text-bad-fg")}>
          {change >= 0 ? "+" : ""}
          {pct(change, 2)}
        </span>{" "}
        <span className="text-muted">over this range</span>
      </p>
      <SharePriceChart points={inRange} />
    </div>
  );
}

// -------------------------------------------------------------------------- portfolio split

function PortfolioSplit({ house, vehicle }: { house: number; vehicle: number }) {
  const total = house + vehicle;
  const slices = [
    { name: "Home loans", value: house, color: "#00d2ff" },
    { name: "Car loans", value: vehicle, color: "#818cf8" },
  ];
  return (
    <div className="flex flex-1 flex-col justify-center gap-5">
      <Donut slices={slices} centerLabel="lent out" />
      <ul className="space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
            <span className="num">
              <span className="font-bold">{total > 0 ? pct(s.value / total, 0) : "–"}</span> <span className="text-muted">{usd(s.value, { compact: true })}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// -------------------------------------------------------------------------- pool rows

function PoolRow({ pool, m, onInvest }: { pool: PoolState; m: PoolMetrics; onInvest: () => void }) {
  const p = pool.params;
  const Icon = POOL_ICON[p.id];
  const tone = m.delinquencyRatio > p.brakeDelinquency ? "bad" : m.delinquencyRatio > 0 ? "warn" : "ok";
  const badge = { ok: "border-ok/35 bg-ok/10 text-ok", warn: "border-warn/40 bg-warn/10 text-warn", bad: "border-bad/45 bg-bad/[0.14] text-bad-fg" }[tone];
  return (
    <li className="pane grid grid-cols-2 items-center gap-x-4 gap-y-3 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))_auto_auto]">
      <div className="col-span-2 flex items-center gap-3 lg:col-span-1">
        <IconBadge icon={Icon} tone={p.id === "vehicle" ? "indigo" : "accent"} />
        <div className="min-w-0">
          <div className="font-bold">{p.name}</div>
          <div className="text-[13px] text-muted">
            ~{pct(p.targetYield, 0)} target yield, gross · borrowers pay {pct(p.annualRate, 0)}
          </div>
        </div>
      </div>
      <Stat label="Pool value" value={usd(m.seniorNav, { compact: true })} />
      <Stat label="Share price" value={m.sharePrice.toFixed(4)} />
      <Stat label="Lent out" value={usd(pool.outstandingPrincipal, { compact: true })} />
      <span className={cx("inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-semibold", badge)}>
        {tone === "ok" ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
        <span className="num">{pct(m.delinquencyRatio, 1)}</span> late
      </span>
      <Button size="sm" onClick={onInvest} className="col-span-2 justify-self-stretch lg:col-span-1 lg:justify-self-end" aria-label={`Invest in the ${p.name.toLowerCase()}`}>
        <Landmark className="h-4 w-4" aria-hidden />
        Invest
      </Button>
    </li>
  );
}

// -------------------------------------------------------------------------- deposit dialog

function DepositForm({ poolId, sharePrice }: { poolId: PoolId; sharePrice: number }) {
  const { client } = useGlassHouse();
  const deposit = useAction();
  const [amount, setAmount] = useState(10_000);
  const { data: balance } = useChainQuery((c) => c.getWalletBalance(c.actor), [client.actor]);
  const unit = client.mode === "mock" ? "test USDC" : "USDC";
  const tooMuch = balance !== null && amount > balance;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between rounded-[12px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm">
        <span className="text-muted">Wallet balance</span>
        <span className="num font-bold">
          {balance === null ? "–" : num(balance, 2)} <span className="font-medium text-muted">{unit}</span>
        </span>
      </div>
      <Field label="Amount (USDC)" hint={amount > 0 ? `About ${num(amount / sharePrice, 2)} shares at ${sharePrice.toFixed(4)}` : "Enter an amount above zero."}>
        <MoneyInput value={amount} onChange={setAmount} step={1000} ariaLabel="Deposit amount" autoFocus />
      </Field>
      {balance !== null && balance > 0 ? (
        <button type="button" onClick={() => setAmount(Math.floor(balance))} className="mt-1.5 text-[13px] font-semibold text-steel underline-offset-2 hover:underline">
          Use the whole balance
        </button>
      ) : null}
      <div className="mt-3 space-y-1">
        {tooMuch ? <ErrorText>That&apos;s more than this wallet holds ({num(balance ?? 0, 2)} {unit}).</ErrorText> : null}
        <ErrorText>{deposit.error}</ErrorText>
        {deposit.last ? <TxNote {...deposit.last} /> : null}
      </div>
      <Button className="mt-4 w-full" disabled={deposit.pending || !(amount > 0) || tooMuch} onClick={() => deposit.run(() => client.deposit(poolId, amount), { success: `Deposited ${usd(amount)} into the ${POOLS[poolId].name.toLowerCase()}`, failure: "Deposit failed" })}>
        {deposit.pending ? "Depositing…" : `Deposit ${usd(amount)}`}
      </Button>
      <p className="mt-4 text-[13px] text-muted">Pool shares are for verified investors only. In this demo anyone with a devnet wallet can try it.</p>
    </div>
  );
}

// -------------------------------------------------------------------------- position and withdrawals

function PositionCard({
  poolId,
  position,
  onInvest,
  actor,
}: {
  poolId: PoolId;
  position: { shares: number; lockedShares: number; value: number } | null;
  onInvest: () => void;
  actor: string;
}) {
  const { client } = useGlassHouse();
  const withdraw = useAction();
  const [shares, setShares] = useState("");
  return (
    <Pane>
      <PaneTitle aside={shortAddr(actor)}>Your position</PaneTitle>
      {position ? (
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Shares" value={num(position.shares, 2)} />
          <Stat label="Value now" value={usd(position.value, { cents: true })} />
          {position.lockedShares > 0 ? <Stat label="Waiting to withdraw" value={num(position.lockedShares, 2)} /> : null}
        </div>
      ) : (
        <Skeleton className="h-14" />
      )}
      <Button size="sm" variant="accent" className="mt-4" onClick={onInvest}>
        <Layers className="h-4 w-4" aria-hidden />
        Invest more
      </Button>
      <div className="mt-5 border-t border-white/[0.08] pt-4">
        <Field label="Shares to withdraw" hint="Requests wait in line and are paid at the share price of that moment, from free cash only.">
          <TextInput inputMode="decimal" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="0" />
        </Field>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="quiet" disabled={withdraw.pending || !(Number(shares) > 0)} onClick={() => withdraw.run(() => client.requestWithdraw(poolId, Number(shares)), { success: "Withdrawal requested", failure: "Withdrawal not requested" })}>
            Request withdrawal
          </Button>
          {position && position.shares > 0 ? (
            <Button variant="quiet" onClick={() => setShares(String(Math.floor(position.shares * 100) / 100))}>
              All
            </Button>
          ) : null}
        </div>
        <div className="mt-2 space-y-1">
          <ErrorText>{withdraw.error}</ErrorText>
          {withdraw.last ? <TxNote {...withdraw.last} /> : null}
        </div>
      </div>
    </Pane>
  );
}

function WithdrawalLine({ pool }: { pool: PoolState | null }) {
  const { client } = useGlassHouse();
  const queue = useAction();
  return (
    <Pane>
      <PaneTitle aside={pool ? `${pool.withdrawQueue.length} waiting` : undefined}>Withdrawal line</PaneTitle>
      {pool && pool.withdrawQueue.length > 0 ? (
        <ol className="mb-3 space-y-1 text-sm">
          {pool.withdrawQueue.map((w) => (
            <li key={w.seq} className="num flex justify-between">
              <span>
                #{w.seq} {shortAddr(w.owner)}
              </span>
              <span>{num(w.shares, 2)} shares</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-3 text-sm text-muted">Nobody is waiting.</p>
      )}
      <Button variant="quiet" size="sm" disabled={queue.pending || !pool?.withdrawQueue.length} onClick={() => pool && queue.run(() => client.processWithdrawals(pool.params.id), { success: "Withdrawal requests paid", failure: "No withdrawals paid" })}>
        Pay the next 3 requests
      </Button>
      <p className="mt-2 text-[13px] text-muted">Anyone can run this. Each transaction pays up to three requests.</p>
      <ErrorText>{queue.error}</ErrorText>
    </Pane>
  );
}
