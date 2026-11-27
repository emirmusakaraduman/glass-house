"use client";

import { Car, Home, Lock, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ListingCard } from "@/components/ListingCard";
import { Button, Field, Modal, MoneyInput, Note, Pane, PaneTitle, SampleDataBadge, Segmented, Skeleton, TextInput, cx } from "@/components/ui";
import { closingCash, maxAffordablePrice } from "@/lib/finance";
import { num, pct, usd } from "@/lib/format";
import { CITIES, type ListingWithComp, type ListingsResponse } from "@/lib/listings/types";
import { POOLS } from "@/lib/pools";
import { saveSelection } from "@/lib/selection";
import type { AssetType } from "@/lib/types";

const PRESETS = [
  { name: "Maria", line: "Developer in Panama City, paid in USDC", type: "house" as const, city: "Panama City", income: 1800, debt: 0, savings: 32_500 },
  { name: "Diego", line: "Designer in Guayaquil, remote clients", type: "vehicle" as const, city: "Guayaquil", income: 900, debt: 0, savings: 9_000 },
];

const PAGE = 6;

// Client-side refinements. They only narrow the listings the API already returned; nothing new is sent.
interface Filters {
  minBeds: number | null;
  minArea: number | null;
  maxAge: number | null;
  minYear: number | null;
  maxKm: number | null;
  transmission: "" | "Automatic" | "Manual";
}
const NO_FILTERS: Filters = { minBeds: null, minArea: null, maxAge: null, minYear: null, maxKm: null, transmission: "" };
type Sort = "price-desc" | "price-asc" | "installment-asc";
const SORTS: { value: Sort; label: string }[] = [
  { value: "price-desc", label: "Price, high to low" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "installment-asc", label: "Lowest monthly installment" },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function matches(l: ListingWithComp, q: string, f: Filters) {
  if (q) {
    const hay = norm([l.title, l.district, l.city, l.type === "vehicle" ? `${l.make ?? ""} ${l.model ?? ""}` : ""].filter(Boolean).join(" "));
    if (!norm(q).split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  if (l.type === "house") {
    if (f.minBeds !== null && (l.bedrooms ?? 0) < f.minBeds) return false;
    if (f.minArea !== null && (l.areaM2 ?? 0) < f.minArea) return false;
    if (f.maxAge !== null && (l.buildingAgeYears === null || l.buildingAgeYears > f.maxAge)) return false;
  } else {
    if (f.minYear !== null && (l.year === null || l.year < f.minYear)) return false;
    if (f.maxKm !== null && (l.km === null || l.km > f.maxKm)) return false;
    if (f.transmission && (l.transmission ?? "").toLowerCase() !== f.transmission.toLowerCase()) return false;
  }
  return true;
}

function filterChips(type: AssetType, f: Filters): { key: keyof Filters; label: string }[] {
  const out: { key: keyof Filters; label: string }[] = [];
  if (type === "house") {
    if (f.minBeds !== null) out.push({ key: "minBeds", label: `${f.minBeds}+ bedrooms` });
    if (f.minArea !== null) out.push({ key: "minArea", label: `${num(f.minArea)}+ m²` });
    if (f.maxAge !== null) out.push({ key: "maxAge", label: `Building up to ${f.maxAge} yr old` });
  } else {
    if (f.minYear !== null) out.push({ key: "minYear", label: `${f.minYear} or newer` });
    if (f.maxKm !== null) out.push({ key: "maxKm", label: `Up to ${num(f.maxKm)} km` });
    if (f.transmission) out.push({ key: "transmission", label: f.transmission });
  }
  return out;
}

export default function FinderPage() {
  const router = useRouter();
  const [type, setType] = useState<AssetType>("house");
  const [city, setCity] = useState("Panama City");
  const [income, setIncome] = useState(1800);
  const [debt, setDebt] = useState(0);
  const [savings, setSavings] = useState(32_500);
  const [live, setLive] = useState(true);
  const [res, setRes] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("price-desc");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE);

  const pool = POOLS[type];
  const budget = useMemo(() => ({ monthlyIncome: income, existingMonthlyDebt: debt, savings }), [income, debt, savings]);
  const max = useMemo(() => maxAffordablePrice(budget, pool), [budget, pool]);
  // Whole dollars, rounded down: never shows more than the computed limit.
  const maxPrice = Math.floor(max.maxPrice);

  // Only type, city and the price range go to the server. Income and savings stay here.
  useEffect(() => {
    if (maxPrice <= 0) {
      setRes(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ type, city, maxPrice: String(maxPrice), minPrice: "0", live: live ? "1" : "0" });
        const r = await fetch(`/api/listings?${qs}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Search failed (${r.status})`);
        setRes((await r.json()) as ListingsResponse);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [type, city, maxPrice, live]);

  // Back to the first page whenever the result set or its refinements change.
  useEffect(() => setVisible(PAGE), [res, query, filters, sort]);

  const all = useMemo(() => (res && res.query.type === type ? res.listings : []), [res, type]);
  const shown = useMemo(() => {
    const list = all.filter((l) => matches(l, query.trim(), filters));
    const installment = (l: ListingWithComp) => closingCash(l.price, POOLS[l.type]).installment;
    const by: Record<Sort, (a: ListingWithComp, b: ListingWithComp) => number> = {
      "price-desc": (a, b) => b.price - a.price,
      "price-asc": (a, b) => a.price - b.price,
      "installment-asc": (a, b) => installment(a) - installment(b),
    };
    return [...list].sort(by[sort]);
  }, [all, query, filters, sort]);

  const chips = filterChips(type, filters);
  const refined = chips.length > 0 || query.trim() !== "";
  const noun = type === "house" ? "homes" : "cars";
  const clearAll = () => {
    setFilters(NO_FILTERS);
    setQuery("");
  };
  const switchType = (v: AssetType) => {
    setType(v);
    setFilters(NO_FILTERS);
    if (!CITIES[v].includes(city)) setCity(CITIES[v][0]);
  };

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------------------ budget and limit */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Pane>
          <PaneTitle>Your budget</PaneTitle>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Segmented
              label="Asset type"
              value={type}
              onChange={switchType}
              options={[
                { value: "house", label: "Home", icon: Home },
                { value: "vehicle", label: "Car", icon: Car },
              ]}
            />
            <select
              aria-label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="h-11 rounded-[12px] border border-white/12 bg-white/[0.04] px-3 text-[15px] hover:border-white/20"
            >
              {CITIES[type].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly income (USDC)">
              <MoneyInput value={income} onChange={setIncome} ariaLabel="Monthly income" />
            </Field>
            <Field label="Existing monthly debt payments">
              <MoneyInput value={debt} onChange={setDebt} ariaLabel="Existing monthly debt payments" step={50} />
            </Field>
            <Field label="Savings for closing" hint="Down payment, 1% fee and 3 installments of collateral.">
              <MoneyInput value={savings} onChange={setSavings} ariaLabel="Savings" step={500} />
            </Field>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <span className="self-center text-muted">Try a demo borrower:</span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  switchType(p.type);
                  setCity(p.city);
                  setIncome(p.income);
                  setDebt(p.debt);
                  setSavings(p.savings);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 font-medium hover:border-accent/50"
                title={p.line}
              >
                {p.type === "house" ? <Home className="h-3.5 w-3.5 text-steel" aria-hidden /> : <Car className="h-3.5 w-3.5 text-steel" aria-hidden />}
                {p.name}, {p.type === "house" ? "home" : "car"}
              </button>
            ))}
          </div>

          <p className="mt-5 flex items-start gap-2 text-[13px] text-muted">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-steel" aria-hidden />
            Calculated in your browser. Your income and savings are not sent to our server or to Firecrawl; the search only uses {type === "house" ? "home" : "car"}, city and price.
          </p>
        </Pane>

        <Pane className="relative overflow-hidden">
          <MapBackdrop />
          <div className="relative">
            <div className="dense text-[13px] text-muted">The most you can pay</div>
            <MaxPrice value={maxPrice} />
            <p className="mt-2 max-w-[56ch] text-[15px] text-muted">
              {max.binding === "cash"
                ? `Your savings set the limit. Closing takes about ${pct(max.cashRatio, 1)} of the price in cash.`
                : `Your income sets the limit. The installment can't be more than ${pct(pool.maxDti, 0)} of your free monthly income.`}
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Limit
                active={max.binding === "income"}
                title="Income limit"
                value={Math.floor(max.byIncome)}
                body={`${pct(pool.maxDti, 0)} of ${usd(max.freeIncome)} free income covers the installment at ${pct(pool.annualRate, 0)} over ${pool.termMonths / 12} years.`}
              />
              <Limit
                active={max.binding === "cash"}
                title="Savings limit"
                value={Math.floor(max.byCash)}
                body={`${pct(1 - pool.maxLtv, 0)} down, ${pct(pool.originationFee, 0)} fee on the loan and ${pool.collateralInstallments} installments of collateral.`}
              />
            </div>
          </div>
        </Pane>
      </div>

      {/* ------------------------------------------------------------ search and filters */}
      <section aria-labelledby="results-title" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <TextInput
              type="search"
              aria-label="Search these listings"
              placeholder="Search by neighborhood, city or model"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="quiet" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog" aria-label={chips.length ? `Filters, ${chips.length} active` : "Filters"} className="px-3.5 sm:px-5">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Filters</span>
            {chips.length > 0 ? <span className="num rounded-full bg-accent px-1.5 text-[12px] leading-5 text-white">{chips.length}</span> : null}
          </Button>
        </div>

        {refined ? (
          <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {query.trim() ? <Chip label={`Search: “${query.trim()}”`} onRemove={() => setQuery("")} /> : null}
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => setFilters((f) => ({ ...f, [c.key]: c.key === "transmission" ? "" : null }))} />
            ))}
            <button onClick={clearAll} className="ml-1 text-sm font-semibold text-steel underline-offset-2 hover:text-ink hover:underline">
              Clear all
            </button>
          </div>
        ) : null}

        {/* ------------------------------------------------------------ results */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="results-title" className="title text-2xl">
              {shown.length} {noun} in {city} under {usd(maxPrice)}
            </h2>
            {refined && all.length !== shown.length ? <span className="text-sm text-muted">of {all.length} found</span> : null}
            {res?.source === "sample" ? <SampleDataBadge /> : null}
            {res?.source === "live" ? (
              <span className="rounded-full border border-ok/35 bg-ok/10 px-2.5 py-0.5 text-[13px] font-semibold text-ok">Live via Firecrawl{res.cached ? ", cached" : ""}</span>
            ) : null}
            {loading ? <span className="text-sm text-muted">Searching…</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-muted">Sorted: {SORTS.find((s) => s.value === sort)?.label.toLowerCase()}</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
              Search live listings
            </label>
          </div>
        </div>

        {res?.note ? <Note tone="warn">{res.note}</Note> : null}
        {res?.source === "sample" && !res.note ? <Note>These are example listings for the demo, not live offers.</Note> : null}
        {error ? <Note tone="bad">{error}</Note> : null}

        {loading || (!res && !error && maxPrice > 0) ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: PAGE }, (_, i) => (
              <Skeleton key={i} className="h-[440px] rounded-[20px]" />
            ))}
          </div>
        ) : all.length === 0 && res ? (
          <EmptyState>
            Nothing under {usd(maxPrice)} in {city}. More savings raise the limit fastest; you can also try the other city.
          </EmptyState>
        ) : shown.length === 0 && res ? (
          <EmptyState>
            None of the {all.length} {noun} under {usd(maxPrice)} match these filters.{" "}
            <button onClick={clearAll} className="font-semibold text-steel underline underline-offset-2">
              Clear all
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {shown.slice(0, visible).map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  maxPrice={maxPrice}
                  onApply={() => {
                    saveSelection({ type, city, budget, listing: l });
                    router.push("/apply");
                  }}
                />
              ))}
            </div>
            {shown.length > visible ? (
              <div className="flex justify-center pt-2">
                <Button variant="quiet" onClick={() => setVisible((v) => v + PAGE)}>
                  Show more listings
                  <span className="text-muted">({shown.length - visible} more)</span>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" description="These narrow the listings already found; nothing new is sent to the server.">
        <FiltersForm
          key={String(filtersOpen)}
          type={type}
          initial={filters}
          initialSort={sort}
          count={(f) => all.filter((l) => matches(l, query.trim(), f)).length}
          onApply={(f, s) => {
            setFilters(f);
            setSort(s);
            setFiltersOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

// -------------------------------------------------------------------------- pieces

function Limit({ title, value, body, active }: { title: string; value: number; body: string; active: boolean }) {
  return (
    <div className={cx("rounded-[12px] border p-3.5 backdrop-blur", active ? "border-accent-light/60 bg-accent/15 shadow-[0_0_24px_-8px_rgb(0_210_255/0.7)]" : "border-white/10 bg-white/[0.03]")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{title}</span>
        {active ? <span className="text-[12.5px] font-semibold text-steel">Sets your limit</span> : null}
      </div>
      <div className="num mt-1 text-xl font-bold">{usd(value)}</div>
      <p className="mt-1 text-[13px] leading-snug text-muted">{body}</p>
    </div>
  );
}

/** The limit, easing to its new value. Screen readers get the final value once; reduced motion jumps straight to it. */
function MaxPrice({ value }: { value: number }) {
  const [shownValue, setShownValue] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShownValue(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 450);
      const cur = a + (value - a) * (1 - Math.pow(1 - k, 3));
      from.current = cur;
      setShownValue(k < 1 ? cur : value);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      <div aria-hidden className="display num text-gold-gradient mt-1 text-[48px] drop-shadow-[0_6px_24px_rgb(245_158_11/0.3)] sm:text-[60px]">
        {usd(Math.round(shownValue))}
      </div>
      <span className="sr-only" aria-live="polite">
        The most you can pay: {usd(value)}
      </span>
    </>
  );
}

/** Very faint street map with two pins behind the limit card. Decorative only. */
function MapBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" className="h-full w-full opacity-[0.16]">
        <g fill="none" stroke="#7de6ff" strokeWidth="1">
          <path d="M-10 60 L250 95 L610 40" />
          <path d="M-10 190 C120 170 220 230 360 200 S560 150 610 170" />
          <path d="M80 -10 L120 350" />
          <path d="M300 -10 L270 350" />
          <path d="M470 -10 C450 120 500 220 480 350" />
          <path d="M-10 290 L610 250" strokeOpacity="0.6" />
          <path d="M160 -10 L210 110 L380 130 L420 350" strokeOpacity="0.5" />
        </g>
        <path d="M-10 120 C100 140 180 90 300 115 S520 160 610 110" fill="none" stroke="#818cf8" strokeOpacity="0.5" strokeWidth="7" />
        <g fill="#7de6ff" fillOpacity="0.25">
          <rect x="330" y="60" width="60" height="40" rx="4" />
          <rect x="140" y="215" width="80" height="45" rx="4" />
          <rect x="500" y="200" width="50" height="35" rx="4" />
        </g>
      </svg>
      <span className="absolute right-[18%] top-[14%] inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/25 text-accent-light opacity-70 shadow-[0_0_24px_rgb(0_210_255/0.6)]">
        <MapPin className="h-4 w-4" />
      </span>
      <span className="absolute right-[6%] top-[42%] inline-flex h-7 w-7 items-center justify-center rounded-full bg-indigo/15 text-indigo opacity-60 shadow-[0_0_20px_rgb(129_140_248/0.5)]">
        <MapPin className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent-light/35 bg-accent/15 py-1 pl-3 pr-1 text-[13px] font-semibold">
      {label}
      <button onClick={onRemove} aria-label={`Remove filter: ${label}`} className="rounded-full p-0.5 text-muted hover:bg-white/10 hover:text-ink">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="pane flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-muted">
        <Search className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-[52ch] text-[15px] text-muted">{children}</p>
    </div>
  );
}

function FiltersForm({
  type,
  initial,
  initialSort,
  count,
  onApply,
}: {
  type: AssetType;
  initial: Filters;
  initialSort: Sort;
  count: (f: Filters) => number;
  onApply: (f: Filters, s: Sort) => void;
}) {
  const [f, setF] = useState<Filters>(initial);
  const [s, setS] = useState<Sort>(initialSort);
  const n = count(f);
  const numField = (key: keyof Filters, label: string, placeholder: string, autoFocus = false) => (
    <Field label={label}>
      <TextInput
        inputMode="numeric"
        placeholder={placeholder}
        data-autofocus={autoFocus ? "" : undefined}
        value={f[key] === null || f[key] === "" ? "" : String(f[key])}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9]/g, "");
          setF((x) => ({ ...x, [key]: v === "" ? null : Number(v) }));
        }}
      />
    </Field>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply(f, s);
      }}
      className="space-y-4"
    >
      {type === "house" ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {numField("minBeds", "Min bedrooms", "Any", true)}
          {numField("minArea", "Min area (m²)", "Any")}
          {numField("maxAge", "Max building age", "Any")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {numField("minYear", "Min year", "Any", true)}
          {numField("maxKm", "Max km", "Any")}
          <Field label="Transmission">
            <select
              value={f.transmission}
              onChange={(e) => setF((x) => ({ ...x, transmission: e.target.value as Filters["transmission"] }))}
              className="h-11 w-full rounded-[12px] border border-white/12 bg-white/[0.04] px-3 text-[15px] hover:border-white/20"
            >
              <option value="">Any</option>
              <option>Automatic</option>
              <option>Manual</option>
            </select>
          </Field>
        </div>
      )}
      <Field label="Sort by">
        <select value={s} onChange={(e) => setS(e.target.value as Sort)} className="h-11 w-full rounded-[12px] border border-white/12 bg-white/[0.04] px-3 text-[15px] hover:border-white/20">
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <Button type="button" variant="quiet" onClick={() => setF(NO_FILTERS)}>
          Reset filters
        </Button>
        <Button type="submit" variant="accent">Show {n} listing{n === 1 ? "" : "s"}</Button>
      </div>
    </form>
  );
}
