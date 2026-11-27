"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Ban,
  Banknote,
  Car,
  CircleDollarSign,
  ExternalLink,
  Eye,
  FileCheck2,
  FilePen,
  Flag,
  Gavel,
  Home,
  KeyRound,
  Landmark,
  Lock,
  MapPin,
  OctagonAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Donut } from "@/components/charts";
import { StatusBadge, isCrankable, loanBand, loanLtv } from "@/components/LoanBits";
import { useAction, useChainQuery, useGlassHouse } from "@/components/providers/ClientProvider";
import { Button, ErrorText, Field, IconBadge, LoadError, MoneyInput, Note, Pane, PaneTitle, Row, Skeleton, Stat, Stepper, TxNote, cx } from "@/components/ui";
import { DATA_SOURCE, explorerTx, loanLabel } from "@/lib/chain";
import { dateTime, pct, shortAddr, shortHash, usd } from "@/lib/format";
import { POOLS } from "@/lib/pools";
import type { Loan, LoanEvent, PoolParams } from "@/lib/types";

const PATH = [
  { key: "applied", label: "Applied" },
  { key: "approved", label: "Approved" },
  { key: "funded", label: "Funds in escrow" },
  { key: "title_confirmed", label: "Title confirmed" },
  { key: "paid_off", label: "Paid off" },
] as const;

const EVENT: Record<LoanEvent["kind"], { text: string; icon: LucideIcon; tone: "accent" | "indigo" | "ok" | "warn" | "bad" }> = {
  applied: { text: "Application signed by borrower and seller", icon: FilePen, tone: "accent" },
  approved: { text: "Underwriter signed the value and document hash", icon: ShieldCheck, tone: "accent" },
  rejected: { text: "Application rejected", icon: Ban, tone: "bad" },
  funded: { text: "Pool funded the loan into escrow", icon: Landmark, tone: "indigo" },
  title_confirmed: { text: "Title agent confirmed transfer and lien", icon: FileCheck2, tone: "indigo" },
  repaid: { text: "Installment paid", icon: CircleDollarSign, tone: "ok" },
  late1: { text: "Marked late (1 missed)", icon: AlertTriangle, tone: "warn" },
  late2: { text: "Marked late (2 missed)", icon: AlertTriangle, tone: "warn" },
  defaulted: { text: "Marked defaulted", icon: OctagonAlert, tone: "bad" },
  recovered: { text: "Sale proceeds recorded", icon: Banknote, tone: "accent" },
  paid_off: { text: "Loan paid off", icon: BadgeCheck, tone: "ok" },
  cancelled: { text: "Cancelled, funds returned", icon: Ban, tone: "bad" },
};

/** Re-renders every second so the countdown moves. */
function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export default function LoanPage() {
  const { id } = useParams<{ id: string }>();
  const { client } = useGlassHouse();
  const { data, error } = useChainQuery(async (c) => ({ loan: await c.getLoan(id) }), [id], 1000);
  const now = useNow();
  const repay = useAction();
  const crank = useAction();
  const roles = useAction();
  const [appraisal, setAppraisal] = useState<number | null>(null);
  const [proceeds, setProceeds] = useState<number | null>(null);

  if (error) return <LoadError error={error} what={`loan ${id}`} />;
  if (data === null) return <Skeleton className="h-64" />;
  const loan = data.loan;
  if (!loan)
    return (
      <Note>
        There is no loan with the id {id}.{" "}
        <Link href="/transparency" className="font-semibold text-steel underline underline-offset-2">
          See every loan
        </Link>
      </Note>
    );

  const p = POOLS[loan.poolId];
  const crankable = isCrankable(loan, now);
  const value = Math.min(loan.price, loan.appraisal ?? loan.price);
  const PoolIcon = loan.poolId === "house" ? Home : Car;

  return (
    <div className="space-y-6">
      <Link href="/transparency" className="inline-flex items-center gap-1.5 text-sm font-semibold text-steel underline-offset-2 hover:text-ink hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All loans
      </Link>

      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 className="display num text-gradient text-5xl sm:text-6xl">{loanLabel(loan)}</h2>
        <StatusBadge status={loan.status} approved={loan.appraisal !== null} />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-0.5 text-[13px] font-semibold">
          <PoolIcon className="h-3.5 w-3.5 text-steel" aria-hidden />
          {p.name}
        </span>
        <span className="inline-flex items-center gap-1 text-muted">
          <MapPin className="h-4 w-4" aria-hidden />
          {loan.region}
        </span>
      </header>

      <Pane>
        <PaneTitle>Where this loan stands</PaneTitle>
        <StatusPath loan={loan} />
        {loan.status === "Late1" || loan.status === "Late2" ? (
          <div className="mt-5">
            <Note tone="warn">
              {loan.missedInstallments} installment{loan.missedInstallments > 1 ? "s" : ""} missed. {pct(p.provisionRates[loan.status === "Late1" ? 1 : 2], 0)} of the remaining principal is set aside
              {loan.status === "Late2" ? ", and one installment was taken from collateral" : ""}. Paying catches the loan up and releases the provision.
            </Note>
          </div>
        ) : null}
        {loan.status === "Defaulted" ? (
          <div className="mt-5">
            <Note tone="bad">
              Three installments missed. On-chain this is only a status: a licensed servicer runs the legal process off-chain. The provision is {usd(loan.provision)}, covered first by the first-loss
              vault.
            </Note>
          </div>
        ) : null}
      </Pane>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-6">
          {/* ------------------------------------------------------------ payments */}
          <Pane>
            <PaneTitle>Payments</PaneTitle>
            <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
              <Donut
                size={168}
                tooltip={false}
                centerValue={`${loan.paidInstallments} / ${loan.termMonths}`}
                centerLabel="installments paid"
                slices={[
                  { name: "Paid", value: loan.paidInstallments, color: "#00d2ff" },
                  { name: "Left", value: Math.max(0, loan.termMonths - loan.paidInstallments), color: "rgb(255 255 255 / 0.1)" },
                ]}
              />
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <Stat label="Installment" value={usd(loan.installment, { cents: true })} />
                <Stat label="Remaining principal" value={usd(loan.remainingPrincipal)} />
                <NextDue loan={loan} p={p} now={now} crankable={crankable} />
              </div>
            </div>
          </Pane>

          {/* ------------------------------------------------------------ actions */}
          <div className="grid gap-6 sm:grid-cols-2">
            <Pane className="flex flex-col">
              <div className="flex items-center gap-2.5">
                <IconBadge icon={CircleDollarSign} size="sm" tone="ok" />
                <h3 className="font-bold">Pay the installment</h3>
              </div>
              <p className="mt-2 text-sm text-muted">
                {usd(loan.installment + loan.lateFeeDue, { cents: true })}
                {loan.lateFeeDue > 0 ? ` including a ${usd(loan.lateFeeDue, { cents: true })} late fee` : ""}. Order: late fee, interest, then principal.
              </p>
              <div className="mt-auto pt-4">
                <Button disabled={repay.pending || !["Active", "Late1", "Late2"].includes(loan.status)} onClick={() => repay.run(() => client.repay(loan.key), { success: `Installment paid on ${loanLabel(loan)}`, failure: "Payment failed" })}>
                  Pay {usd(loan.installment + loan.lateFeeDue, { cents: true })}
                </Button>
                <div className="mt-2">
                  <ErrorText>{repay.error}</ErrorText>
                  {repay.last ? <TxNote {...repay.last} /> : null}
                </div>
              </div>
            </Pane>
            <section
              aria-labelledby="flag-title"
              className={cx("pane flex flex-col p-5 sm:p-6", crankable && "border-bad/45 bg-[linear-gradient(135deg,rgb(248_113_113/0.16),rgb(248_113_113/0.04))] hover:border-bad/60")}
            >
              <div className="flex items-center gap-2.5">
                <IconBadge icon={Flag} size="sm" tone={crankable ? "bad" : "accent"} />
                <h3 id="flag-title" className="font-bold">
                  Flag a missed payment
                </h3>
              </div>
              <p className="mt-2 text-sm text-muted">
                Anyone can run this check from any wallet. The program reads the clock and does nothing twice for the same period, so no servicer can hide a late payment.
              </p>
              <div className="mt-auto pt-4">
                <Button variant={crankable ? "danger" : "quiet"} disabled={crank.pending} onClick={() =>
                    crank.run(() => client.crankLoan(loan.key), {
                      success: (r) => ({ title: `${loanLabel(loan)}: ${r.message}`, tone: r.changed ? "ok" : "info" }),
                      failure: "Check failed",
                    })
                  }>
                  Run the check
                </Button>
                <div className="mt-2" aria-live="polite">
                  <ErrorText>{crank.error}</ErrorText>
                  {crank.last ? <TxNote {...crank.last} /> : null}
                </div>
              </div>
            </section>
          </div>

          <RolePanel
            loan={loan}
            appraisal={appraisal ?? loan.price}
            setAppraisal={setAppraisal}
            proceeds={proceeds ?? Math.round(value * p.recoveryCoeff)}
            setProceeds={setProceeds}
            action={roles}
            onApprove={(v) => roles.run(() => client.approveLoan(loan.key, v, randomHex()), { success: `${loanLabel(loan)} approved by the underwriter`, failure: "Approval failed" })}
            onReject={() => roles.run(() => client.rejectLoan(loan.key), { success: `${loanLabel(loan)} rejected, funds returned`, failure: "Rejection failed" })}
            onFund={() => roles.run(() => client.fundLoan(loan.key), { success: `${loanLabel(loan)} funded into escrow`, failure: "Funding failed" })}
            onConfirm={() => roles.run(() => client.confirmTitle(loan.key), { success: `Title confirmed, ${loanLabel(loan)} is active`, failure: "Title not confirmed" })}
            onRecover={(v) => roles.run(() => client.recordRecovery(loan.key, v), { success: `Recovery recorded for ${loanLabel(loan)}`, failure: "Recovery not recorded" })}
          />
        </div>

        <Pane>
          <PaneTitle>History</PaneTitle>
          <ol>
            {[...loan.events].reverse().map((e, i, all) => {
              const ev = EVENT[e.kind];
              return (
                <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < all.length - 1 ? <span className="absolute bottom-0 left-[13px] top-8 w-px bg-white/10" aria-hidden /> : null}
                  <IconBadge icon={ev.icon} size="sm" tone={ev.tone} />
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold">{ev.text}</div>
                    <div className="text-muted">
                      {dateTime(e.at)}
                      {e.amount ? `, ${usd(e.amount, { cents: e.amount < 10_000 })}` : ""}
                      {e.by && e.kind !== "repaid" ? `, sent by ${shortAddr(e.by)}` : ""}
                    </div>
                    {e.note ? <div className="text-muted">{e.note}</div> : null}
                    {e.signature && !e.signature.startsWith("mock-") ? (
                      <a href={explorerTx(e.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-steel underline-offset-2 hover:underline">
                        Transaction <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Pane>
      </div>

      {/* ------------------------------------------------------------ public vs private */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Pane>
          <h2 className="title mb-4 flex items-center gap-2.5 text-lg">
            <IconBadge icon={Eye} size="sm" />
            Public on-chain record
          </h2>
          <div className="text-[15px]">
            <Row k="Loan-to-value" v={`${pct(loanLtv(loan), 1)} (max ${pct(p.maxLtv, 0)})`} />
            <Row k="Value band" v={loanBand(loan)} />
            <Row k="Fixed rate" v={pct(loan.annualRate, 0)} />
            <Row k="Term" v={`${loan.termMonths} months`} />
            <Row k="Principal" v={usd(loan.principal)} />
            <Row k="Collateral locked" v={usd(loan.collateral, { cents: true })} />
            <Row k="Provision" v={loan.provision > 0 ? usd(loan.provision) : "None"} />
            <Row k="Region" v={loan.region} />
            <Row k="Borrower wallet, new for this loan" v={<span className="font-mono text-[13.5px]">{shortAddr(loan.borrower)}</span>} />
            <Row k="Seller wallet" v={<span className="font-mono text-[13.5px]">{shortAddr(loan.seller)}</span>} />
            <Row k="Document hash, salted" v={<span className="font-mono text-[13.5px]" title={loan.docHash ?? ""}>{shortHash(loan.docHash)}</span>} />
            <Row k="Listing hash, salted" v={<span className="font-mono text-[13.5px]" title={loan.assetRefHash ?? ""}>{shortHash(loan.assetRefHash)}</span>} />
          </div>
        </Pane>
        <Pane>
          <h2 className="title mb-4 flex items-center gap-2.5 text-lg">
            <IconBadge icon={Lock} size="sm" tone="indigo" />
            Off-chain, encrypted
          </h2>
          <ul className="space-y-2.5 text-[15px]">
            {["Name, ID and KYC documents", "Income and employer", "Full address", "Title or plate numbers", "The appraisal report", "The listing URL", "The link between this loan and a person"].map((f) => (
              <li key={f} className="flex items-center gap-2.5">
                <Lock className="h-3.5 w-3.5 shrink-0 text-indigo" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
            A regulator or auditor can be given selective access to the link between this loan and a person; deleting that link makes the on-chain hashes unlinkable. This is designed to reduce the
            conflict with the right to erasure; compliance depends on legal review.
          </p>
        </Pane>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------- status path

function StatusPath({ loan }: { loan: Loan }) {
  const done = new Set(loan.events.map((e) => e.kind));
  const reached = PATH.map((s) => done.has(s.key) || (s.key === "approved" && loan.appraisal !== null));
  const firstOpen = reached.findIndex((r) => !r);
  const current = firstOpen === -1 ? PATH.length : firstOpen;
  const tagAt = (i: number) => {
    if (i !== Math.min(current, PATH.length - 1)) return undefined;
    switch (loan.status) {
      case "Late1":
        return { text: "Late, 1 missed", tone: "warn" as const };
      case "Late2":
        return { text: "Late, 2 missed", tone: "warn" as const };
      case "Defaulted":
        return { text: "Defaulted", tone: "bad" as const };
      case "Recovered":
        return { text: "Recovered after default", tone: "bad" as const };
      case "Rejected":
        return { text: "Rejected", tone: "bad" as const };
      case "Cancelled":
        return { text: "Cancelled", tone: "bad" as const };
      default:
        return undefined;
    }
  };
  return <Stepper current={current} steps={PATH.map((s, i) => ({ label: s.label, tag: tagAt(i) }))} />;
}

// -------------------------------------------------------------------------- next due countdown

function NextDue({ loan, p, now, crankable }: { loan: Loan; p: PoolParams; now: number; crankable: boolean }) {
  if (loan.nextDueAt === null) return <Stat label="Next due" value="–" hint={loan.status === "PaidOff" ? "Paid off" : "Starts once the title is confirmed"} />;
  const toDue = loan.nextDueAt - now;
  const graceEnd = loan.nextDueAt + p.graceSeconds * 1000;
  const grace = `${p.graceSeconds}s grace in the demo (7 days in production)`;
  if (toDue > 0) return <Stat label="Next due in" value={clock(toDue)} hint={`${grace}. One month is ${p.periodSeconds}s here.`} />;
  if (now < graceEnd) return <Stat label="Due now, in grace" value={clock(graceEnd - now)} tone="warn" hint={`${grace}. After that anyone can flag it.`} />;
  return (
    <Stat
      label="Overdue by"
      value={clock(now - graceEnd)}
      tone="bad"
      hint={crankable ? "Past due and grace: anyone can flag it now." : "Already flagged for this period."}
    />
  );
}

// -------------------------------------------------------------------------- next signature

function RolePanel(props: {
  loan: Loan;
  appraisal: number;
  setAppraisal: (v: number) => void;
  proceeds: number;
  setProceeds: (v: number) => void;
  action: ReturnType<typeof useAction>;
  onApprove: (v: number) => void;
  onReject: () => void;
  onFund: () => void;
  onConfirm: () => void;
  onRecover: (v: number) => void;
}) {
  const { loan, action } = props;
  const toApprove = loan.status === "Pending" && loan.appraisal === null;
  const toFund = loan.status === "Pending" && loan.appraisal !== null;
  const toConfirm = loan.status === "Funded";
  const toRecover = loan.status === "Defaulted";
  const anything = toApprove || toFund || toConfirm || toRecover;

  return (
    <Pane>
      <PaneTitle aside={DATA_SOURCE === "mock" ? "Demo: on devnet each step needs that role's wallet" : undefined}>Next signature</PaneTitle>
      {!anything ? <p className="mb-4 text-sm text-muted">Nothing to sign for this loan right now.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <RoleCard icon={ShieldCheck} title="Approve or reject" role="Underwriter" active={toApprove}>
          <p className="text-[13px] text-muted">Checks income, the currency match and the value off-chain, then signs the value and a salted document hash.</p>
          {toApprove ? (
            <div className="mt-3 space-y-3">
              <Field label="Signed value (appraisal)">
                <MoneyInput value={props.appraisal} onChange={props.setAppraisal} step={500} ariaLabel="Appraisal" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="accent" disabled={action.pending} onClick={() => props.onApprove(props.appraisal)}>
                  Approve
                </Button>
                <Button size="sm" variant="danger" disabled={action.pending} onClick={props.onReject}>
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </RoleCard>
        <RoleCard icon={Landmark} title="Fund the loan" role="to confirm with the program; it runs the checks itself" active={toFund}>
          <p className="text-[13px] text-muted">Checks loan / min(price, value) against the pool limit, the 10% cash buffer and the lending brake, then moves the pool&apos;s money into escrow.</p>
          {toFund ? (
            <Button size="sm" variant="accent" className="mt-3" disabled={action.pending} onClick={props.onFund}>
              Fund the loan
            </Button>
          ) : null}
        </RoleCard>
        <RoleCard icon={KeyRound} title="Confirm title" role="Title agent" active={toConfirm}>
          <p className="text-[13px] text-muted">Confirms the transfer and the lien. Then escrow pays the seller and the loan goes active.</p>
          {toConfirm ? (
            <Button size="sm" variant="accent" className="mt-3" disabled={action.pending} onClick={props.onConfirm}>
              Confirm title
            </Button>
          ) : null}
        </RoleCard>
        <RoleCard icon={Gavel} title="Record recovery" role="Recovery agent" active={toRecover}>
          <p className="text-[13px] text-muted">Sale proceeds arrive as a real USDC transfer; then the loss order runs: collateral, sale, first-loss vault, reserve, investors.</p>
          {toRecover ? (
            <div className="mt-3 space-y-3">
              <Field label="Sale proceeds">
                <MoneyInput value={props.proceeds} onChange={props.setProceeds} step={500} ariaLabel="Sale proceeds" />
              </Field>
              <Button size="sm" variant="accent" disabled={action.pending} onClick={() => props.onRecover(props.proceeds)}>
                Record the recovery
              </Button>
            </div>
          ) : null}
        </RoleCard>
      </div>
      <div className="mt-3" aria-live="polite">
        <ErrorText>{action.error}</ErrorText>
        {action.last ? <TxNote {...action.last} /> : null}
      </div>
    </Pane>
  );
}

function RoleCard({ icon, title, role, active, children }: { icon: LucideIcon; title: string; role: string; active: boolean; children: React.ReactNode }) {
  return (
    <div className={cx("rounded-[12px] border p-4", active ? "border-accent-light/50 bg-accent/[0.12] shadow-[0_0_24px_-10px_rgb(0_210_255/0.8)]" : "border-white/[0.08] bg-white/[0.02]")}>
      <div className="flex items-start gap-2.5">
        <IconBadge icon={icon} size="sm" tone={active ? "accent" : "indigo"} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{title}</span>
            {active ? (
              <span className="rounded-full border border-accent-light/40 bg-accent/20 px-2 py-0.5 text-[11.5px] font-semibold text-steel">Next</span>
            ) : null}
          </div>
          <div className="text-[12.5px] text-muted">Signed by: {role}</div>
        </div>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function randomHex() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}
