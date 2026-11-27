"use client";

// lucide's Home icon is imported as HomeIcon so it doesn't clash with the page component.
import { AlertTriangle, ArrowRight, Blocks, Car, Eye, FileCode2, Home as HomeIcon, KeyRound, Lock, type LucideIcon, Percent, PlayCircle, Search, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { GlassHouseHero } from "@/components/hero/GlassHouseHero";
import { LoanTable } from "@/components/LoanBits";
import { PoolLossStack } from "@/components/PoolLayers";
import { useChainQuery } from "@/components/providers/ClientProvider";
import { ButtonLink, GlassCard, IconBadge, LoadError, Pane, PaneTitle, Skeleton, cx } from "@/components/ui";
import { DATA_SOURCE, computeMetrics } from "@/lib/chain";
import { pct, usd } from "@/lib/format";
import { HOUSE_POOL, VEHICLE_POOL } from "@/lib/pools";

const STEPS: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: "Set your budget",
    body: "Enter your monthly USDC income and savings. We work out the most you can pay, right in your browser. Those numbers never leave it.",
    icon: Wallet,
  },
  {
    title: "Pick a listing",
    body: "Firecrawl pulls homes and cars for sale under that price. Choose one and its price fills your application.",
    icon: Search,
  },
  {
    title: "Money waits in escrow",
    body: "The pool funds the loan, but the seller is paid only after the title agent confirms the transfer and the lien.",
    icon: Lock,
  },
  {
    title: "Repay in the currency you earn",
    body: "Fixed monthly installments in USDC. Interest stays in the pool and grows every investor's share.",
    icon: KeyRound,
  },
];

// Every number here comes from the pool parameters in src/lib/pools.ts.
const FEATURES: { title: string; body: string; icon: LucideIcon }[] = [
  { title: "Every loan is public", body: "Each loan is its own on-chain account, with no identity attached.", icon: Eye },
  {
    title: "We take the first loss",
    body: `A first-loss vault of at least ${pct(HOUSE_POOL.firstLossTarget, 0)} sits in front of investors.`,
    icon: ShieldCheck,
  },
  {
    title: "Rules in code",
    body: `${pct(1 - HOUSE_POOL.maxLtv, 0)} down on homes, ${pct(1 - VEHICLE_POOL.maxLtv, 0)} on cars, fixed rate, no leverage.`,
    icon: FileCode2,
  },
  { title: "Homes and cars", body: "Two isolated pools from one program.", icon: Car },
];

export default function Home() {
  const { data, error } = useChainQuery(async (c) => {
    const [pools, loans] = await Promise.all([c.getPools(), c.getLoans()]);
    return { pools, loans };
  }, []);

  const house = data?.pools.find((p) => p.params.id === "house");
  const hm = house && data ? computeMetrics(house, data.loans) : null;
  const latest = data ? [...data.loans].filter((l) => l.status !== "Rejected").sort((a, b) => b.createdAt - a.createdAt).slice(0, 6) : [];
  const houseLoans = data?.loans.filter((l) => l.poolId === "house") ?? [];
  const onChain = houseLoans.filter((l) => !["Rejected", "Cancelled"].includes(l.status)).length;
  const late = houseLoans.filter((l) => ["Late1", "Late2", "Defaulted"].includes(l.status)).length;

  return (
    <div className="space-y-24 sm:space-y-28">
      {/* ------------------------------------------------------------ hero */}
      <section className="grid items-center gap-12 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10 lg:pt-8">
        <div className="hero-enter">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-[13px] font-semibold text-ink backdrop-blur">
            {DATA_SOURCE === "mock" ? (
              <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden />
            ) : (
              <span className="h-2 w-2 rounded-full bg-ok shadow-[0_0_8px_rgb(52_211_153/0.8)]" aria-hidden />
            )}
            {DATA_SOURCE === "mock" ? "Demo data, same rules as the devnet program" : "Live on Solana devnet"}
          </span>

          <h1 className="mt-6">
            <span className="hero-wordmark display block text-[56px] sm:text-[88px] lg:text-[76px] xl:text-[96px]">GlassHouse</span>
            <span className="display mt-3 block max-w-[16ch] text-[30px] text-ink sm:text-[40px]">Transparent home and car loans on Solana</span>
          </h1>
          <p className="mt-6 max-w-[48ch] text-[18px] leading-relaxed text-muted">
            Earn in USDC, borrow in USDC: home and car loans anyone can audit, where we take the first loss.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/finder" className="gold-halo">
              Find a home in my budget <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
            <ButtonLink href="#how" variant="quiet">
              <PlayCircle className="h-4 w-4" aria-hidden /> How it works
            </ButtonLink>
          </div>
        </div>

        <HeroVisual />
      </section>

      {/* ------------------------------------------------------------ features */}
      <section aria-label="What makes GlassHouse different" className="pane -mt-8 p-2 sm:-mt-12">
        <ul className="grid divide-y divide-white/[0.07] sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3.5 p-4 sm:p-5">
              <IconBadge icon={f.icon} />
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold">{f.title}</h2>
                <p className="mt-1 text-[14px] leading-snug text-muted">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------------ loss order */}
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
        <div>
          <h2 className="display text-gradient text-[34px] sm:text-[42px]">Who pays if a borrower stops</h2>
          <p className="mt-4 max-w-[48ch] text-[17px] leading-relaxed text-muted">
            A missed payment first eats the borrower&apos;s own down payment and collateral, then the sale of the home, then our first-loss vault and the reserve. The loss reaches investors last, and it stays in that pool.
          </p>
          <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-muted">These bars are the home pool as it stands now, not an illustration.</p>
        </div>
        <Pane aria-label="Home pool loss order">
          <PaneTitle aside={hm ? `Share price ${hm.sharePrice.toFixed(4)}` : undefined}>Home pool, live</PaneTitle>
          {house && hm ? <PoolLossStack pool={house} metrics={hm} /> : <Skeleton className="h-48" />}
          <p className="mt-5 border-t border-white/[0.08] pt-4 text-[15px]">
            Home pool right now: <span className="num font-semibold">{onChain}</span> loans on-chain, <span className="num font-semibold">{late}</span> late or defaulted,{" "}
            <span className="num font-semibold">{hm ? usd(hm.seniorImpairment) : "–"}</span> lost by investors.
          </p>
        </Pane>
      </section>

      {/* ------------------------------------------------------------ loans */}
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="display text-gradient text-[34px] sm:text-[42px]">Every loan, in the open</h2>
            <p className="mt-2 max-w-[62ch] text-muted">Pseudonymous ids, city-level region and a value band. Names, addresses and income stay off-chain.</p>
          </div>
          <Link href="/transparency" className="inline-flex items-center gap-1.5 font-semibold text-steel underline-offset-4 hover:text-ink hover:underline">
            See all loans and pool health <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <LoadError error={error} what="the latest loans" />
        <Pane className="p-3 sm:p-4">
          {data ? (
            latest.length ? (
              <LoanTable loans={latest} compact />
            ) : (
              <p className="px-2 py-6 text-muted">No loans yet. The first application shows up here as soon as it is signed.</p>
            )
          ) : (
            <Skeleton className="h-60" />
          )}
        </Pane>
      </section>

      {/* ------------------------------------------------------------ how it works */}
      <section id="how" className="scroll-mt-24">
        <h2 className="display text-gradient text-[34px] sm:text-[42px]">From budget to keys</h2>
        <p className="mt-2 max-w-[62ch] text-muted">Budget first, listing second, and the seller is paid only after the title is confirmed.</p>
        <ol className="mt-8 grid gap-5 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="pane relative p-5">
              {i < STEPS.length - 1 ? (
                <>
                  {/* Connector to the next card: horizontal on desktop, vertical when the cards stack. */}
                  <span className="bg-accent-gradient absolute left-full top-[42px] hidden h-px w-5 opacity-70 lg:block" aria-hidden />
                  <span className="absolute left-[41px] top-full h-5 w-px bg-[linear-gradient(180deg,var(--color-accent),var(--color-accent-light))] opacity-70 lg:hidden" aria-hidden />
                </>
              ) : null}
              <div className="flex items-center gap-3">
                <IconBadge icon={s.icon} />
                <span className="num text-sm font-bold text-steel">Step {i + 1}</span>
              </div>
              <h3 className="title mt-4 text-lg">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------ pools */}
      <section>
        <h2 className="display text-gradient text-[34px] sm:text-[42px]">One engine, two isolated pools</h2>
        <p className="mb-6 mt-2 max-w-[62ch] text-muted">Both pools come from the same program with different parameters. A default in one can never touch the other.</p>
        <Pane className="overflow-x-auto p-3 sm:p-4">
          <table className="w-full min-w-[560px] text-[15px]">
            <thead>
              <tr className="dense text-left text-[13px] text-muted">
                <th className="px-3 py-2 font-medium" />
                <th className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-2 text-ink">
                    <IconBadge icon={HomeIcon} size="sm" /> Home pool
                  </span>
                </th>
                <th className="px-3 py-2 font-medium">
                  <span className="inline-flex items-center gap-2 text-ink">
                    <IconBadge icon={Car} size="sm" tone="indigo" /> Car pool
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Max loan-to-value", pct(HOUSE_POOL.maxLtv, 0), pct(VEHICLE_POOL.maxLtv, 0)],
                ["Fixed rate", pct(HOUSE_POOL.annualRate, 0), pct(VEHICLE_POOL.annualRate, 0)],
                ["Term", `${HOUSE_POOL.termMonths / 12} years`, `${VEHICLE_POOL.termMonths / 12} years`],
                ["Installment cap", `${pct(HOUSE_POOL.maxDti, 0)} of income`, `${pct(VEHICLE_POOL.maxDti, 0)} of income, after existing debts`],
                ["Investor target, gross", `about ${pct(HOUSE_POOL.targetYield, 0)}`, `about ${pct(VEHICLE_POOL.targetYield, 0)}`],
                ["Collateral", "Mortgage to the pool's SPV", "Lien to the SPV, insurance required"],
                ["First-loss vault", `At least ${pct(HOUSE_POOL.firstLossTarget, 0)} of principal`, `At least ${pct(VEHICLE_POOL.firstLossTarget, 0)} of principal`],
              ].map(([k, a, b]) => (
                <tr key={k} className="border-t border-white/[0.07] transition-colors hover:bg-white/[0.03]">
                  <td className="px-3 py-3 text-muted">{k}</td>
                  <td className="num px-3 py-3 font-medium">{a}</td>
                  <td className="num px-3 py-3 font-medium">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Pane>
      </section>

      {/* ------------------------------------------------------------ closing */}
      <GlassCard variant="glow" className="relative overflow-hidden px-6 py-12 text-center sm:px-10 sm:py-16">
        {/* The hero photo lives in the hero now; here a quiet cyan wash with a warm hint at the bottom. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_90%_at_50%_0%,rgb(0_210_255/0.16),transparent_70%),radial-gradient(50%_60%_at_50%_115%,rgb(245_158_11/0.09),transparent_70%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-[70%] rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <h2 className="display relative text-[30px] sm:text-[44px]">
          Paid in USDC? <span className="text-gradient">See what you can buy.</span>
        </h2>
        <p className="relative mx-auto mt-3 max-w-[52ch] text-muted">Enter your income and savings. The math runs in your browser, and the listings under your limit show up right away.</p>
        <div className="relative mt-7 flex justify-center">
          <ButtonLink href="/finder" variant="accent">
            Open the listing finder <ArrowRight className="h-4 w-4" aria-hidden />
          </ButtonLink>
        </div>
      </GlassCard>
    </div>
  );
}

/**
 * The "blueprint to real home" hero: the photo of the glass house, traced in cyan lines first.
 * Chips appear one by one once the picture is done (~4.4s), then float on large screens;
 * below lg they line up in a row under the picture. With reduced motion they are there at once.
 */
function HeroVisual() {
  const chips: { key: string; icon: LucideIcon; strong: string; rest: string; pos: string; at: string }[] = [
    {
      key: "rate",
      icon: Percent,
      strong: pct(HOUSE_POOL.annualRate, 0),
      rest: "fixed rate on home loans",
      pos: "lg:-left-14 lg:top-[3%]",
      at: "4.4s",
    },
    {
      key: "down",
      icon: HomeIcon,
      strong: pct(1 - HOUSE_POOL.maxLtv, 0),
      rest: "minimum down payment",
      pos: "lg:-bottom-6 lg:right-12 xl:bottom-auto xl:-right-8 xl:top-[4%]",
      at: "4.65s",
    },
    { key: "solana", icon: Blocks, strong: "", rest: "Built on Solana", pos: "lg:-left-8 lg:bottom-[6%]", at: "4.9s" },
  ];

  return (
    <figure className="relative mx-auto mt-6 w-full max-w-[720px] lg:mt-0">
      <GlassHouseHero>
        {/* Below lg: one row of three compact chips under the picture. lg and up: floating around it. */}
        <ul role="list" className="mt-5 grid grid-cols-3 gap-2 lg:mt-0 lg:block">
          {chips.map((c) => (
            <li
              key={c.key}
              className={cx(
                "flex flex-col items-start gap-1.5 rounded-[12px] border border-white/15 bg-[rgb(19_28_49/0.72)] p-2.5 text-[12.5px] leading-snug shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_12px_30px_-12px_rgb(0_0_0/0.8)] backdrop-blur-xl",
                "hero-chip lg:absolute lg:flex-row lg:items-center lg:gap-2.5 lg:py-2 lg:pl-2 lg:pr-3.5 lg:text-[13.5px]",
                c.pos,
              )}
              style={{ ["--cd" as string]: c.at }}
            >
              <IconBadge icon={c.icon} size="sm" />
              <span>
                {c.strong ? <strong className="num mr-1 block text-[15px] font-extrabold lg:inline">{c.strong}</strong> : null}
                <span className={c.strong ? "text-muted" : "font-semibold"}>{c.rest}</span>
              </span>
            </li>
          ))}
        </ul>
      </GlassHouseHero>
      <figcaption className="sr-only">Pool rules shown next to the picture come from the program parameters.</figcaption>
    </figure>
  );
}
