"use client";

import { AlertTriangle, BedDouble, Building, Calendar, Car, CircleSlash, Cog, ExternalLink, Fuel, Gauge, Home, MapPin, Ruler, type LucideIcon } from "lucide-react";
import listingImages from "@/data/listing-images.json";
import { closingCash, closingCashWithBuffer } from "@/lib/finance";
import { num, pct, usd } from "@/lib/format";
import type { Listing, ListingWithComp } from "@/lib/listings/types";
import { MAX_VEHICLE_AGE_YEARS, POOLS } from "@/lib/pools";
import { useTheme } from "./providers/ThemeProvider";
import { Button, cx } from "./ui";

/** Listing ids with a photo at public/listings/{id}.webp (written by scripts/listing-images.ts). */
const LOCAL_PHOTOS = new Set<string>(listingImages as string[]);

/** Small stable hash so each placeholder gets its own hue, angle and details. */
function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Night-time line drawing on a navy-cyan gradient. Hue, light angle and details vary per listing id. */
function Placeholder({ id, type, kind }: { id: string; type: "house" | "vehicle"; kind: "house" | "tower" | "sedan" | "tall" }) {
  const s = seedOf(id);
  const hue = 192 + (s % 34); // cyan to blue
  const angle = 20 + ((s >>> 6) % 50);
  const gx = 30 + ((s >>> 12) % 40);
  const lit = (n: number) => ((s >>> (n + 3)) & 1) === 1;
  const gid = `ph-${id}`;
  const skyline = Array.from({ length: 9 }, (_, i) => 6 + ((s >>> (i * 3)) % 14));
  // Night scene on dark, a pale day scene on light; lines and windows follow the theme.
  const light = useTheme().theme === "light";
  const c = light
    ? { bg0: `hsl(${hue} 70% 96%)`, bg1: `hsl(${hue + 18} 55% 88%)`, glow: `hsl(${hue + 8} 80% 70%)`, line0: "#0e7490", line1: lit(1) ? "#4f46e5" : "#0891b2", sky: "#0f172a", glass: "#0891b2", lamp: "#f59e0b", wheel: `hsl(${hue} 30% 28%)`, beam: "#f59e0b" }
    : { bg0: `hsl(${hue} 55% 9%)`, bg1: `hsl(${hue + 18} 60% 16%)`, glow: `hsl(${hue + 8} 85% 62%)`, line0: "#e0f7ff", line1: lit(1) ? "#a5b4fc" : "#7de6ff", sky: "#ffffff", glass: "#7de6ff", lamp: "#fcd34d", wheel: `hsl(${hue} 55% 9%)`, beam: "#fde68a" };

  return (
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`${gid}-bg`} gradientTransform={`rotate(${angle} 0.5 0.5)`}>
          <stop offset="0" stopColor={c.bg0} />
          <stop offset="1" stopColor={c.bg1} />
        </linearGradient>
        <radialGradient id={`${gid}-glow`} cx={`${gx}%`} cy="78%" r="60%">
          <stop offset="0" stopColor={c.glow} stopOpacity="0.45" />
          <stop offset="1" stopColor={`hsl(${hue} 80% 50%)`} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${gid}-line`} x1="0" x2="1">
          <stop offset="0" stopColor={c.line0} />
          <stop offset="1" stopColor={c.line1} />
        </linearGradient>
      </defs>
      <rect width="200" height="120" fill={`url(#${gid}-bg)`} />
      <rect width="200" height="120" fill={`url(#${gid}-glow)`} />
      {/* distant skyline */}
      <g fill={c.sky} fillOpacity="0.05">
        {skyline.map((h, i) => (
          <rect key={i} x={i * 23} y={78 - h} width="17" height={h + 10} />
        ))}
      </g>
      <line x1="0" y1="96" x2="200" y2="96" stroke={c.sky} strokeOpacity="0.08" />

      {kind === "tower" ? (
        <g stroke={`url(#${gid}-line)`} strokeWidth="1.6" strokeLinejoin="round" fill="none">
          {/* apartment tower: glass slab with a lit window grid */}
          <rect x="82" y="22" width="40" height="74" fill={c.glass} fillOpacity="0.08" />
          <path d="M122 22 l12 6 v68" strokeOpacity="0.55" />
          {Array.from({ length: 12 }, (_, i) => {
            const x = 87 + (i % 3) * 11;
            const y = 28 + Math.floor(i / 3) * 16;
            return <rect key={i} x={x} y={y} width="7" height="10" stroke="none" fill={lit(i) ? c.lamp : c.glass} fillOpacity={lit(i) ? 0.6 : 0.14} />;
          })}
          <path d={`M${lit(4) ? 150 : 56} 96 v-10`} strokeOpacity="0.5" />
          <circle cx={lit(4) ? 150 : 56} cy="80" r="6" strokeOpacity="0.5" />
        </g>
      ) : type === "house" ? (
        <g stroke={`url(#${gid}-line)`} strokeWidth="1.6" strokeLinejoin="round" fill="none">
          {/* simple glass house: two floors and a slanted roof */}
          <path d="M70 52 L100 36 L132 52" />
          <rect x="74" y="52" width="54" height="44" fill={c.glass} fillOpacity="0.08" />
          <path d="M74 74 H128 M101 52 V96" strokeOpacity="0.55" />
          {[
            [78, 56],
            [105, 56],
            [78, 78],
            [105, 78],
          ].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="19" height="14" stroke="none" fill={lit(i) ? c.lamp : c.glass} fillOpacity={lit(i) ? 0.55 : 0.12} />
          ))}
          {/* tree */}
          <path d={`M${lit(5) ? 150 : 52} 96 v-12`} strokeOpacity="0.5" />
          <circle cx={lit(5) ? 150 : 52} cy="78" r="7" strokeOpacity="0.5" />
        </g>
      ) : (
        <g stroke={`url(#${gid}-line)`} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" fill="none">
          {/* side view of a car on a road with headlight beam; SUVs and pickups sit taller */}
          {kind === "tall" ? (
            <>
              <path d="M52 86 h96 v-14 l-10 -4 -8 -18 h-54 l-10 18 -14 4 z" fill={c.glass} fillOpacity="0.1" />
              <path d="M82 68 l6 -14 h40 l6 14 z" strokeOpacity="0.6" />
            </>
          ) : (
            <>
              <path d="M52 86 h96 v-10 l-14 -5 -12 -13 h-40 l-14 13 -10 3 z" fill={c.glass} fillOpacity="0.1" />
              <path d="M84 71 l9 -10 h21 l9 10 z" strokeOpacity="0.6" />
            </>
          )}
          <circle cx="74" cy="88" r="7" fill={c.wheel} />
          <circle cx="128" cy="88" r="7" fill={c.wheel} />
          <path d="M148 80 L196 72 L196 92 Z" stroke="none" fill={c.beam} fillOpacity={lit(2) ? 0.16 : 0.08} />
          <path d="M10 104 h22 M50 104 h22 M90 104 h22 M130 104 h22 M170 104 h22" strokeOpacity="0.3" />
        </g>
      )}
    </svg>
  );
}

/** Which drawing fits the listing: apartments get a tower, SUVs and pickups a taller body. */
function placeholderKind(l: Listing): "house" | "tower" | "sedan" | "tall" {
  if (l.type === "house") return /apartment|flat|condo|tower/i.test(l.title) ? "tower" : "house";
  return /tucson|sportage|cr-v|rav4|kicks|hilux|d-max|pickup|suv|4x4/i.test(`${l.title} ${l.model ?? ""}`) ? "tall" : "sedan";
}

function Spec({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon className="h-3.5 w-3.5 text-steel" aria-hidden />
      {children}
    </li>
  );
}

/** Photo (listing image, then public/listings/{id}.webp) or the drawn placeholder. Fills its parent. */
export function ListingVisual({ listing }: { listing: Listing }) {
  const photo = listing.imageUrl ?? (LOCAL_PHOTOS.has(listing.id) ? `/listings/${listing.id}.webp` : null);
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
  ) : (
    <Placeholder id={listing.id} type={listing.type} kind={placeholderKind(listing)} />
  );
}

export function ListingCard({ listing, maxPrice, onApply }: { listing: ListingWithComp; maxPrice: number; onApply: () => void }) {
  const p = POOLS[listing.type];
  const cash = closingCash(listing.price, p);
  const buffered = closingCashWithBuffer(listing.price, p);
  const tooOld = listing.type === "vehicle" && listing.year !== null && new Date().getFullYear() - listing.year > MAX_VEHICLE_AGE_YEARS;
  const overBudget = listing.price > maxPrice;
  const blocked = tooOld ? `Not eligible: over ${MAX_VEHICLE_AGE_YEARS} years old` : overBudget ? "Above your limit" : null;
  const sample = listing.source === "sample";
  const place = [listing.district, listing.city].filter(Boolean).join(", ");

  return (
    <article className="pane flex flex-col overflow-hidden p-0 motion-safe:transition-[border-color,transform] motion-safe:duration-200 motion-safe:hover:-translate-y-1">
      <div className="relative aspect-[5/3] w-full overflow-hidden border-b border-haze/10 bg-night">
        <ListingVisual listing={listing} />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-haze/15 bg-frost/70 px-2.5 py-1 text-[12.5px] font-semibold text-ink backdrop-blur">
          {listing.type === "house" ? <Home className="h-3.5 w-3.5 text-steel" aria-hidden /> : <Car className="h-3.5 w-3.5 text-steel" aria-hidden />}
          {listing.type === "house" ? "Home" : "Car"}
        </span>
        {sample ? (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-warn/40 bg-frost/75 px-2 py-0.5 text-[12px] font-semibold text-warn backdrop-blur" title="Example listing from listings.seed.json, not a live offer">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Sample
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="num text-[26px] font-extrabold leading-none tracking-tight">{usd(listing.price)}</div>
        <h3 className="mt-2 text-[15px] font-semibold leading-snug">{listing.title}</h3>
        {place ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {place}
          </p>
        ) : null}

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted" aria-label="Details">
          {listing.type === "house" ? (
            <>
              {listing.bedrooms ? <Spec icon={BedDouble}>{listing.bedrooms} bed</Spec> : null}
              {listing.areaM2 ? <Spec icon={Ruler}>{num(listing.areaM2)} m²</Spec> : null}
              {listing.buildingAgeYears !== null ? <Spec icon={Building}>{listing.buildingAgeYears} yr old</Spec> : null}
            </>
          ) : (
            <>
              {listing.year ? <Spec icon={Calendar}>{listing.year}</Spec> : null}
              {listing.km !== null ? <Spec icon={Gauge}>{num(listing.km)} km</Spec> : null}
              {listing.transmission ? <Spec icon={Cog}>{listing.transmission}</Spec> : null}
              {listing.fuel ? <Spec icon={Fuel}>{listing.fuel}</Spec> : null}
            </>
          )}
        </ul>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-haze/[0.08] pt-3">
          <div>
            <dt className="dense text-[12.5px] text-muted">Monthly installment</dt>
            <dd className="num text-[17px] font-bold">{usd(cash.installment, { cents: true })}</dd>
          </div>
          <div>
            <dt className="dense text-[12.5px] text-muted">Cash at closing, estimated</dt>
            <dd className="num text-[17px] font-bold">{usd(cash.total)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[12.5px] leading-snug text-muted">
          Plan for up to <span className="num font-semibold text-ink">{usd(buffered.total)}</span> if the appraisal comes in 10% lower.
        </p>

        {listing.comp.flagged && listing.comp.delta !== null ? (
          <p className="mt-3 flex gap-2 rounded-[12px] border border-warn/35 bg-warn/[0.08] px-3 py-2 text-[13px] leading-snug text-warn backdrop-blur">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {pct(listing.comp.delta, 0)} above the median of {listing.comp.peers} similar listings
              {listing.comp.basis === "price_per_m2" ? " (per m²)" : " (same model, ±1 year)"}. The underwriter will see this.
            </span>
          </p>
        ) : null}
        {tooOld ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-bad-fg">
            <CircleSlash className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Not eligible: over {MAX_VEHICLE_AGE_YEARS} years old, so the car pool can&apos;t finance it.
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
          {listing.url ? (
            <a href={listing.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-steel underline-offset-2 hover:text-ink hover:underline">
              Open listing <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <span />
          )}
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" onClick={onApply} disabled={blocked !== null} aria-describedby={blocked ? `${listing.id}-blocked` : undefined}>
              Apply with this listing
            </Button>
            {blocked ? (
              <span id={`${listing.id}-blocked`} className="text-[12px] text-muted">
                {blocked}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
