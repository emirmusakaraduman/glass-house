"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  Copy,
  Car,
  ChevronDown,
  CircleCheck,
  FileCheck2,
  Home,
  Landmark,
  Link2,
  Loader2,
  MapPin,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListingVisual } from "@/components/ListingCard";
import { useAction, useChainQuery, useGlassHouse } from "@/components/providers/ClientProvider";
import { AmortizationTable, TotalCostCard } from "@/components/TotalCostCard";
import { Button, ButtonLink, ErrorText, Field, GlassCard, IconBadge, Modal, MoneyInput, Note, Row, Segmented, Stepper, TextInput, TxNote, cx } from "@/components/ui";
import { DEMO_WALLET, DATA_SOURCE, loanLabel } from "@/lib/chain";
import { debtToIncome, totalCost, type TotalCost } from "@/lib/finance";
import { num, pct, shortAddr, usd } from "@/lib/format";
import { CITIES, type Listing } from "@/lib/listings/types";
import { POOLS } from "@/lib/pools";
import { listingRefHash, loadSelection, type Selection } from "@/lib/selection";
import type { AssetType, PoolParams } from "@/lib/types";

const STEPS = [
  { label: "Details", hint: "What and your income" },
  { label: "Financing", hint: "Down payment and cost" },
  { label: "Review and sign", hint: "Seller and send" },
];
const MAX_DOWN = 0.8;
const DEMO_SELLER = "Se11erDemoWa11etGLASSHouse111111111111111111";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Plain-language problem with a seller address, or null when it looks like a Solana address. */
function sellerProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (!BASE58.test(s)) return "Solana addresses use base58 only: no 0, O, I or l, and no spaces or symbols.";
  if (s.length < 32 || s.length > 44) return `A Solana address is 32 to 44 characters long; this one has ${s.length}.`;
  return null;
}

export default function ApplyPage() {
  const { client } = useGlassHouse();
  const { publicKey } = useWallet();
  const [sel, setSel] = useState<Selection | null>(null);
  const [type, setType] = useState<AssetType>("house");
  const [city, setCity] = useState("Panama City");
  const [price, setPrice] = useState(100_000);
  const [downPct, setDownPct] = useState(0.3);
  const [income, setIncome] = useState(1800);
  const [debt, setDebt] = useState(0);
  const [seller, setSeller] = useState("");
  const [created, setCreated] = useState<{ key: string; label: string } | null>(null);
  const [handoff, setHandoff] = useState<{ link: string; loanKey: string } | null>(null);
  const [step, setStep] = useState(0);
  const [amortOpen, setAmortOpen] = useState(false);
  const action = useAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    const s = loadSelection();
    if (!s) return; // no hand-off from the finder: manual entry on the Details step
    setSel(s);
    setType(s.type);
    setCity(s.listing?.city ?? s.city);
    if (s.listing) setPrice(s.listing.price);
    setDownPct(1 - POOLS[s.type].maxLtv);
    setIncome(s.budget.monthlyIncome);
    setDebt(s.budget.existingMonthlyDebt);
  }, []);

  // Move focus to the step heading when the step changes (not on first load).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step, created]);

  const pool = POOLS[type];
  const minDown = 1 - pool.maxLtv;
  const down = Math.round(price * Math.max(downPct, minDown) * 100) / 100;
  const cost = useMemo(() => totalCost(price, down, pool), [price, down, pool]);
  const dti = debtToIncome(cost.installment, { monthlyIncome: income, existingMonthlyDebt: debt });
  const borrower = publicKey?.toBase58() ?? (DATA_SOURCE === "mock" ? DEMO_WALLET : null);
  const sameWallet = !!seller.trim() && seller.trim() === borrower;
  const listing = sel?.listing && sel.listing.price === price && sel.type === type ? sel.listing : null;
  const detached = !!sel?.listing && !listing;
  const { data: balance } = useChainQuery((c) => c.getWalletBalance(c.actor), [client.actor]);
  const shortOfCash = balance !== null && balance + 1e-6 < cost.cashAtClosing;
  const sellerError = sellerProblem(seller);
  // Chain mode with a seller on another device: the borrower signs first and shares a link.
  const remoteSeller = client.mode === "chain" && !!client.prepareApplyLoan && !!seller.trim() && seller.trim() !== client.demoSeller;

  const blockers: string[][] = [
    [
      price > 0 ? null : "Enter a price above zero.",
      income > 0 ? null : "Enter your monthly income.",
      income > 0 && debt >= income ? "Existing debt payments use up all of your income." : null,
    ].filter((x): x is string => !!x),
    [price > 0 ? null : "Go back and enter a price."].filter((x): x is string => !!x),
    [
      !borrower ? "Connect a wallet to sign." : null,
      !seller.trim() ? "Add the seller's wallet address." : null,
      sellerError,
      sameWallet ? "The seller can't use the borrower's wallet." : null,
      shortOfCash ? "Not enough USDC in this wallet for the cash at closing." : null,
    ].filter((x): x is string => !!x),
  ];
  const blocked = blockers[step];

  async function submit() {
    const ref = listing ? await listingRefHash(listing) : null;
    const args = { poolId: type, price, downPayment: down, seller: seller.trim(), region: city, assetRefHash: ref?.hash ?? null };
    if (remoteSeller && client.prepareApplyLoan) {
      const prepare = client.prepareApplyLoan;
      const h = await action.run(() => prepare(args).then((x) => ({ ...x, signature: "", mock: false })), { failure: "Link not created" });
      if (h) setHandoff({ link: `${window.location.origin}/cosign#${h.payload}`, loanKey: h.loanKey });
      return;
    }
    const r = await action.run(() => client.applyLoan(args), {
      success: "Application sent",
      failure: "Application not sent",
    });
    if (r) {
      const l = await client.getLoan(r.loanKey);
      if (l) setCreated({ key: l.key, label: loanLabel(l) });
    }
  }

  function startOver() {
    setCreated(null);
    setHandoff(null);
    action.clear();
    setSeller("");
    setStep(0);
  }

  const summary = <LoanSummary listing={listing} detached={detached} type={type} price={price} city={city} cost={cost} pool={pool} />;

  return (
    <div className="space-y-6">
      {/* Mobile: the summary folds into a strip above the wizard. */}
      <details className="pane group overflow-hidden p-0 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-[13px] text-muted">Loan summary</span>
            <span className="num font-bold">
              {usd(cost.installment, { cents: true })}
              <span className="font-medium text-muted"> / month · {usd(price)}</span>
            </span>
          </span>
          <ChevronDown className="h-5 w-5 text-muted transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-haze/[0.08] p-4">{summary}</div>
      </details>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {created ? (
          <GlassCard variant="glow" className="text-center">
            <div className="flex flex-col items-center gap-4 py-6">
              <IconBadge icon={CircleCheck} tone="ok" size="lg" />
              <h2 ref={headingRef} tabIndex={-1} className="display text-3xl outline-none">
                Application {created.label} sent
              </h2>
              <p className="max-w-[52ch] text-muted">
                The underwriter now checks your income and the value off-chain. Your down payment, fee and collateral wait in this loan&apos;s escrow; if it&apos;s rejected or the title isn&apos;t
                confirmed in time, they come back to you.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <ButtonLink href={`/loans/${created.key}`} variant="accent">
                  Track {created.label} <ArrowRight className="h-4 w-4" aria-hidden />
                </ButtonLink>
                <Button variant="quiet" onClick={startOver}>
                  Start another application
                </Button>
              </div>
              {action.last ? <TxNote signature={action.last.signature} mock={action.last.mock} /> : null}
            </div>
          </GlassCard>
        ) : handoff ? (
          <SellerHandoff
            link={handoff.link}
            loanKey={handoff.loanKey}
            seller={seller.trim()}
            headingRef={headingRef}
            onSent={(key, label) => setCreated({ key, label })}
            onCancelled={() => setHandoff(null)}
          />
        ) : (
          <GlassCard className="space-y-6">
            <Stepper steps={STEPS} current={step} onStepClick={setStep} />

            <h2 ref={headingRef} tabIndex={-1} className="title border-t border-haze/[0.08] pt-5 text-xl outline-none">
              <span className="num mr-2 text-sm font-bold text-steel">Step {step + 1}</span>
              {STEPS[step].label}
            </h2>

            {step === 0 ? (
              <DetailsStep
                listing={listing}
                detached={detached}
                type={type}
                setType={(v) => {
                  setType(v);
                  setDownPct(1 - POOLS[v].maxLtv);
                  if (!CITIES[v].includes(city)) setCity(CITIES[v][0]);
                }}
                price={price}
                setPrice={setPrice}
                city={city}
                setCity={setCity}
                income={income}
                setIncome={setIncome}
                debt={debt}
                setDebt={setDebt}
              />
            ) : null}

            {step === 1 ? (
              <div className="space-y-6">
                <section aria-labelledby="down-title">
                  <h3 id="down-title" className="text-[15px] font-bold">
                    Your down payment
                  </h3>
                  <p className="text-[13px] text-muted">
                    At least {pct(minDown, 0)} for {type === "house" ? "homes" : "cars"}. The program checks the loan against the lower of the price and the underwriter&apos;s value.
                  </p>
                  <DownSlider value={Math.max(downPct, minDown)} min={minDown} max={MAX_DOWN} price={price} onChange={setDownPct} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DraftField
                      label="Down payment, percent"
                      suffix="%"
                      value={Math.max(downPct, minDown)}
                      format={(v) => (v * 100).toFixed(0)}
                      parse={(s) => Number(s.replace(/[^0-9.]/g, "")) / 100}
                      onCommit={(v) => setDownPct(Math.min(MAX_DOWN, Math.max(minDown, v)))}
                    />
                    <DraftField
                      label="Down payment, USD"
                      prefix="$"
                      value={down}
                      format={(v) => String(Math.round(v))}
                      parse={(s) => Number(s.replace(/[^0-9.]/g, ""))}
                      onCommit={(d) => price > 0 && setDownPct(Math.min(MAX_DOWN, Math.max(minDown, d / price)))}
                    />
                  </div>
                  <p className="mt-2 text-[13px] text-muted">
                    Loan {usd(cost.loan)}, {pct(cost.ltv, 1)} of the price.
                  </p>
                </section>

                <AffordBar dti={dti} pool={pool} />

                <section aria-label="Total cost" className="pane-flat p-4 sm:p-5">
                  <TotalCostCard price={price} downPayment={down} pool={pool} />
                  <Button variant="quiet" size="sm" className="mt-4" onClick={() => setAmortOpen(true)} aria-haspopup="dialog">
                    <Table2 className="h-4 w-4" aria-hidden />
                    See the full amortization table
                  </Button>
                </section>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <section>
                  <Field label="Seller's wallet address" hint="The seller signs the application too and is paid from escrow after the title is confirmed.">
                    <TextInput
                      value={seller}
                      onChange={(e) => setSeller(e.target.value)}
                      placeholder="Seller wallet (base58)"
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={!!sellerError || sameWallet}
                      aria-describedby="seller-error"
                      className="font-mono text-[14px] tracking-tight"
                    />
                  </Field>
                  <div id="seller-error" className="mt-1.5 space-y-1">
                    {sellerError ? <ErrorText>{sellerError}</ErrorText> : null}
                    {sameWallet ? <ErrorText>The seller can&apos;t use the borrower&apos;s wallet.</ErrorText> : null}
                  </div>
                  {!seller ? (
                    <button onClick={() => setSeller(client.demoSeller ?? DEMO_SELLER)} className="mt-2 text-sm font-semibold text-steel underline underline-offset-2">
                      Use the demo seller wallet
                    </button>
                  ) : null}
                  <p className="mt-2 text-[13px] text-muted">
                    The chain only blocks the same wallet in both roles. A second wallet owned by the same person is caught by the title agent&apos;s off-chain identity check.
                  </p>
                </section>

                <section aria-labelledby="pay-title" className="pane-flat p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id="pay-title" className="font-bold">
                      You pay at signing
                    </h3>
                    <span className="text-sm text-muted">
                      Wallet {borrower ? shortAddr(borrower) : "not connected"}:{" "}
                      <span className="num font-semibold text-ink">{balance === null ? "–" : num(balance, 2)}</span> {client.mode === "mock" ? "test USDC" : "USDC"}
                    </span>
                  </div>
                  <div className="mt-2 text-[15px]">
                    <Row k="Down payment" v={usd(cost.downPayment, { cents: true })} />
                    <Row k={`Origination fee, ${pct(pool.originationFee, 0)}`} v={usd(cost.fee, { cents: true })} />
                    <Row k={`Collateral, ${pool.collateralInstallments} installments`} v={usd(cost.collateral, { cents: true })} />
                    <div className="mt-1 border-t border-haze/[0.08] pt-1">
                      <Row k="Cash at closing" v={usd(cost.cashAtClosing, { cents: true })} strong />
                    </div>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">It goes into this loan&apos;s escrow. If the underwriter rejects it or the title isn&apos;t confirmed in time, it comes back to you.</p>
                  {shortOfCash ? (
                    <div className="mt-3">
                      <Note tone="warn">
                        This wallet holds {num(balance ?? 0, 2)} USDC; signing needs {usd(cost.cashAtClosing, { cents: true })}. Put more down later, choose a cheaper listing, or top up the wallet.
                      </Note>
                    </div>
                  ) : null}
                </section>

                <Timeline />
              </div>
            ) : null}

            {/* ------------------------------------------------------------ navigation */}
            <div className="border-t border-haze/[0.08] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button variant="quiet" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className={cx(step === 0 && "invisible")}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button variant="accent" onClick={() => setStep((s) => s + 1)} disabled={blocked.length > 0} aria-describedby={blocked.length ? "step-blockers" : undefined}>
                    Continue <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                ) : (
                  <Button onClick={submit} disabled={action.pending || blocked.length > 0} aria-describedby={blocked.length ? "step-blockers" : undefined}>
                    {action.pending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
                      </>
                    ) : remoteSeller ? (
                      "Sign and create the seller's link"
                    ) : (
                      "Sign and send application"
                    )}
                  </Button>
                )}
              </div>
              {blocked.length ? (
                <ul id="step-blockers" className="mt-3 space-y-0.5 text-right text-[13px] text-muted">
                  {blocked.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2">
                <ErrorText>{action.error}</ErrorText>
              </div>
            </div>
          </GlassCard>
        )}

        <aside className="hidden lg:sticky lg:top-28 lg:block" aria-label="Loan summary">
          <GlassCard>{summary}</GlassCard>
        </aside>
      </div>

      <Modal open={amortOpen} onClose={() => setAmortOpen(false)} title="Amortization" description={`${usd(cost.loan)} over ${pool.termMonths} months at ${pct(pool.annualRate, 0)} fixed.`} size="lg">
        <AmortizationTable loan={cost.loan} pool={pool} heading={false} />
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------------------- step 1

function DetailsStep(p: {
  listing: Listing | null;
  detached: boolean;
  type: AssetType;
  setType: (v: AssetType) => void;
  price: number;
  setPrice: (v: number) => void;
  city: string;
  setCity: (v: string) => void;
  income: number;
  setIncome: (v: number) => void;
  debt: number;
  setDebt: (v: number) => void;
}) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="buying-title" className="space-y-4">
        <h3 id="buying-title" className="text-[15px] font-bold">
          What you&apos;re buying
        </h3>
        {p.listing ? (
          <div className="flex gap-4 rounded-[12px] border border-haze/10 bg-haze/[0.04] p-3">
            <div className="h-20 w-28 shrink-0 overflow-hidden rounded-[12px] border border-haze/10">
              <ListingVisual listing={p.listing} />
            </div>
            <div className="min-w-0">
              <div className="font-semibold">{p.listing.title}</div>
              <div className="text-sm text-muted">{[p.listing.district, p.listing.city].filter(Boolean).join(", ")}</div>
              <div className="mt-1 text-[13px] text-muted">
                From the listing finder{p.listing.source === "sample" ? " (sample listing)" : ""}. The listing is stored as a salted hash; only the value band goes on-chain.
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {p.detached ? "You changed the price or type, so the listing from the finder is no longer attached. " : "No listing picked. "}
            Enter the details by hand, or{" "}
            <Link href="/finder" className="font-semibold text-steel underline underline-offset-2">
              find one in your budget
            </Link>
            .
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Type">
            <Segmented
              label="Asset type"
              value={p.type}
              onChange={p.setType}
              options={[
                { value: "house", label: "Home", icon: Home },
                { value: "vehicle", label: "Car", icon: Car },
              ]}
            />
          </Field>
          <Field label="Price">
            <MoneyInput value={p.price} onChange={p.setPrice} step={500} ariaLabel="Price" />
          </Field>
          <Field label="City">
            <select value={p.city} onChange={(e) => p.setCity(e.target.value)} className="h-11 w-full rounded-[12px] border border-haze/12 bg-haze/[0.04] px-3 text-[15px] hover:border-haze/20">
              {[...new Set([...CITIES[p.type], p.city])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section aria-labelledby="income-title" className="space-y-4">
        <h3 id="income-title" className="text-[15px] font-bold">
          Your income
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Monthly income (USDC)">
            <MoneyInput value={p.income} onChange={p.setIncome} ariaLabel="Monthly income" />
          </Field>
          <Field label="Existing monthly debt payments">
            <MoneyInput value={p.debt} onChange={p.setDebt} step={50} ariaLabel="Existing debt payments" />
          </Field>
        </div>
        <p className="text-[13px] text-muted">The underwriter checks your income off-chain. It is never written on-chain.</p>
      </section>
    </div>
  );
}

// -------------------------------------------------------------------------- step 2 pieces

/**
 * Down payment slider. The track runs from 0 to the max; the native range input only covers
 * minimum..max, so neither pointer nor keyboard can go below the minimum, and assistive tech
 * reads the real minimum. The 0..minimum part is drawn as a locked zone.
 */
function DownSlider({ value, min, max, price, onChange }: { value: number; min: number; max: number; price: number; onChange: (v: number) => void }) {
  const at = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className="px-5 pb-2 pt-3">
      <div className="relative h-[84px]">
        <span className="fill-accent num pointer-events-none absolute top-0 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[13px] font-bold" style={{ left: at(value) }} aria-hidden>
          {pct(value, 0)}
        </span>
        <div className="absolute inset-x-0 top-[38px] h-2.5 rounded-full bg-haze/10">
          <div className="absolute inset-y-0 left-0 rounded-l-full bg-[repeating-linear-gradient(135deg,rgb(var(--haze-rgb)/0.14)_0_4px,transparent_4px_8px)]" style={{ width: at(min) }} />
          <div className="bg-accent-gradient absolute inset-y-0 left-0 rounded-full shadow-[0_0_14px_rgb(0_210_255/calc(0.6*var(--glow)))]" style={{ width: at(value) }} />
        </div>
        <span className="absolute top-[30px] h-[26px] w-px bg-haze/60" style={{ left: at(min) }} aria-hidden />
        <span className="absolute top-[60px] -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold text-muted" style={{ left: at(min) }} aria-hidden>
          Minimum {pct(min, 0)}
        </span>
        <input
          type="range"
          min={Number(min.toFixed(4))}
          max={max}
          step={0.01}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Down payment"
          aria-valuetext={`${pct(value, 0)} down, ${usd(price * value)}`}
          className="peer absolute top-[28px] h-[30px] cursor-pointer opacity-0"
          style={{ left: at(min), right: 0 }}
        />
        <span
          className="pointer-events-none absolute top-[33px] h-5 w-5 -translate-x-1/2 rounded-full border-2 border-white bg-accent shadow-[0_0_0_4px_rgb(0_210_255/calc(0.35*var(--glow))),0_4px_12px_rgb(0_0_0/0.5)] peer-focus-visible:ring-4 peer-focus-visible:ring-accent-light/80"
          style={{ left: at(value) }}
          aria-hidden
        />
        <span className="absolute right-0 top-[60px] text-[12px] text-muted" aria-hidden>
          {pct(max, 0)}
        </span>
      </div>
    </div>
  );
}

/** Text field that lets you type freely and applies (clamped) on blur or Enter. */
function DraftField({
  label,
  value,
  format,
  parse,
  onCommit,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  parse: (s: string) => number;
  onCommit: (v: number) => void;
  prefix?: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      const n = parse(draft);
      if (Number.isFinite(n) && draft.trim() !== "") onCommit(n);
    }
    setDraft(null);
  };
  return (
    <Field label={label}>
      <div className="relative">
        {prefix ? <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted">{prefix}</span> : null}
        <TextInput
          inputMode="decimal"
          value={draft ?? format(value)}
          onFocus={() => setDraft(format(value))}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cx("num", prefix && "pl-8", suffix && "pr-9")}
        />
        {suffix ? <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted">{suffix}</span> : null}
      </div>
    </Field>
  );
}

/** Installment / free income against the limit: green under it, amber over it. */
function AffordBar({ dti, pool }: { dti: number; pool: PoolParams }) {
  const finite = Number.isFinite(dti);
  const scale = Math.max(0.6, finite ? dti * 1.1 : 0.6);
  const ok = finite && dti <= pool.maxDti;
  const fill = finite ? Math.min(1, dti / scale) : 1;
  return (
    <section aria-labelledby="afford-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="afford-title" className="text-[15px] font-bold">
          Can you afford it?
        </h3>
        <span className={cx("num text-sm font-bold", ok ? "text-ok" : "text-warn")}>{finite ? pct(dti, 1) : "No free income"} of free income</span>
      </div>
      <div className="relative pb-5 pt-1">
        <div className="relative h-3 overflow-hidden rounded-full bg-haze/10" role="img" aria-label={`Installment is ${finite ? pct(dti, 1) : "more than all"} of free income; the limit is ${pct(pool.maxDti, 0)}.`}>
          <div className={cx("h-full rounded-full", ok ? "bg-ok shadow-[0_0_12px_rgb(52_211_153/calc(0.6*var(--glow)))]" : "bg-warn shadow-[0_0_12px_rgb(251_146_60/0.6)]")} style={{ width: `${fill * 100}%` }} />
        </div>
        <span className="absolute top-0 h-5 w-0.5 rounded bg-ink" style={{ left: `${(pool.maxDti / scale) * 100}%` }} aria-hidden />
        <span className="absolute top-6 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold text-muted" style={{ left: `${(pool.maxDti / scale) * 100}%` }} aria-hidden>
          {pct(pool.maxDti, 0)} limit
        </span>
      </div>
      {ok ? (
        <Note>
          The installment is <span className="num font-semibold">{pct(dti, 1)}</span> of your free income, under the {pct(pool.maxDti, 0)} limit. Income is in USDC, the same currency as the loan.
        </Note>
      ) : (
        <Note tone="warn">
          The installment would be <span className="num font-semibold">{finite ? pct(dti, 1) : "more than all"}</span> of your free income. The underwriter approves up to {pct(pool.maxDti, 0)}; put more down or
          choose a cheaper listing.
        </Note>
      )}
    </section>
  );
}

// -------------------------------------------------------------------------- step 3 pieces

function Timeline() {
  const items: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: ShieldCheck, title: "Underwriter checks income and value", body: "Off-chain. Only the signed value and a salted document hash go on-chain." },
    { icon: Landmark, title: "The pool funds the loan into escrow", body: "Money waits in this loan's escrow account, not with the seller." },
    { icon: FileCheck2, title: "Title agent confirms transfer and lien", body: "Then escrow pays the seller and the loan becomes active." },
    { icon: CalendarClock, title: "Your first installment is due a month later", body: "Fixed amount in USDC. Paying off early has no penalty." },
  ];
  return (
    <section aria-labelledby="next-title">
      <h3 id="next-title" className="mb-3 font-bold">
        What happens next
      </h3>
      <ol className="space-y-0">
        {items.map((it, i) => (
          <li key={it.title} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 ? <span className="absolute bottom-0 left-5 top-10 w-px bg-[linear-gradient(180deg,var(--color-accent),transparent)]" aria-hidden /> : null}
            <IconBadge icon={it.icon} />
            <div className="pt-1">
              <div className="text-[15px] font-semibold">{it.title}</div>
              <div className="text-[13.5px] text-muted">{it.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// -------------------------------------------------------------------------- summary

function LoanSummary({
  listing,
  detached,
  type,
  price,
  city,
  cost,
  pool,
}: {
  listing: Listing | null;
  detached: boolean;
  type: AssetType;
  price: number;
  city: string;
  cost: TotalCost;
  pool: PoolParams;
}) {
  const place = listing ? [listing.district, listing.city].filter(Boolean).join(", ") : city;
  return (
    <div className="space-y-4">
      <h2 className="title hidden text-lg lg:block">Loan summary</h2>
      {listing ? (
        <div className="flex gap-3">
          <div className="h-20 w-28 shrink-0 overflow-hidden rounded-[12px] border border-haze/10">
            <ListingVisual listing={listing} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-snug">{listing.title}</div>
            <div className="mt-1 inline-flex items-center gap-1 text-sm text-muted">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {place}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[12px] border border-dashed border-haze/15 px-3.5 py-3 text-sm text-muted">
          {detached ? "Listing detached after you changed the price or type." : "No listing picked."}{" "}
          <Link href="/finder" className="font-semibold text-steel underline underline-offset-2">
            Find one in your budget
          </Link>
          <div className="mt-1 inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {place}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="num text-[28px] font-extrabold tracking-tight">{usd(price)}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-haze/15 bg-haze/[0.05] px-2.5 py-1 text-[12.5px] font-semibold">
          {type === "house" ? <Home className="h-3.5 w-3.5 text-steel" aria-hidden /> : <Car className="h-3.5 w-3.5 text-steel" aria-hidden />}
          {type === "house" ? "Home loan" : "Car loan"}
        </span>
      </div>

      <div className="border-t border-haze/[0.08] pt-4">
        <div className="dense text-[13px] text-muted">Monthly installment</div>
        <div className="display num text-gradient text-[40px] drop-shadow-[0_6px_24px_rgb(0_210_255/calc(0.5*var(--glow)))]">{usd(cost.installment, { cents: true })}</div>
        <div className="text-sm text-muted">
          {pool.termMonths} months, {pct(pool.annualRate, 0)} fixed
        </div>
      </div>

      <div className="text-[15px]">
        <Row k="Loan-to-value" v={pct(cost.ltv, 1)} />
        <Row k="Down payment" v={usd(cost.downPayment)} />
        <Row k="Cash at closing" v={usd(cost.cashAtClosing, { cents: true })} strong />
        <Row k="Effective annual cost" v={`about ${pct(cost.effectiveAnnualCost, 2)}`} />
        <p className="text-[12.5px] text-muted">Fee included, not a legal APR.</p>
      </div>
    </div>
  );
}

/**
 * Chain mode, seller on another device: the borrower has signed; the seller opens this link,
 * checks the terms, signs and sends. This card waits until the loan shows up on chain.
 */
function SellerHandoff({
  link,
  loanKey,
  seller,
  headingRef,
  onSent,
  onCancelled,
}: {
  link: string;
  loanKey: string;
  seller: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onSent: (key: string, label: string) => void;
  onCancelled: () => void;
}) {
  const { client } = useGlassHouse();
  const [copied, setCopied] = useState(false);
  const cancel = useAction();
  const { data: loan } = useChainQuery((c) => c.getLoan(loanKey), [loanKey], 4000);

  useEffect(() => {
    if (loan) onSent(loan.key, loanLabel(loan));
  }, [loan, onSent]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <GlassCard variant="glow" className="space-y-5">
      <div className="flex items-start gap-3">
        <IconBadge icon={Link2} tone="accent" size="md" />
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="title text-xl outline-none">
            Send this link to the seller
          </h2>
          <p className="mt-1 text-muted">
            You signed the application. It goes on chain when the seller ({shortAddr(seller)}) opens the link, checks the terms and signs with that wallet. Nothing leaves your wallet until then.
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="cosign-link" className="text-sm font-semibold">
          Seller&apos;s link
        </label>
        <div className="mt-1.5 flex gap-2">
          <input id="cosign-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-[12px] border border-haze/12 bg-haze/[0.04] px-3 font-mono text-[13px]" />
          <Button variant="accent" onClick={copy} aria-live="polite">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="mt-1.5 text-[13px] text-muted">The link doesn&apos;t expire. It stops working once the seller sends it, or if you cancel it below.</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Waiting for the seller to sign…
      </div>

      <div className="border-t border-haze/[0.08] pt-4">
        <Button
          variant="quiet"
          disabled={cancel.pending || !client.cancelCosignLinks}
          onClick={async () => {
            const r = await cancel.run(() => client.cancelCosignLinks!(), { success: "Link cancelled", failure: "Link not cancelled" });
            if (r) onCancelled();
          }}
        >
          Cancel this link
        </Button>
        <div className="mt-2">
          <ErrorText>{cancel.error}</ErrorText>
        </div>
      </div>
    </GlassCard>
  );
}
