import "server-only";
import type { AssetType } from "../types";
import type { HouseListing, Listing, VehicleListing } from "./types";

// Server-side Firecrawl call. The API key never leaves the server.
// Only the asset type, the city and the price range go to Firecrawl; never income or savings.
//
// Sources are configured per type as URL templates, so the team can switch sites after
// checking robots.txt and the terms of use (doc: only sources that allow it or offer an API):
//   FIRECRAWL_HOUSE_URLS="https://site.example/venta/{city}?min={minPrice}&max={maxPrice}"
//   FIRECRAWL_VEHICLE_URLS="https://site.example/autos/{city}?max={maxPrice}"
// Several URLs can be separated with "|".

const API = "https://api.firecrawl.dev/v2/scrape";

export interface LiveQuery {
  type: AssetType;
  city: string;
  minPrice: number;
  maxPrice: number;
}

const HOUSE_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          price: { type: "number", description: "Asking price as a plain number" },
          currency: { type: "string", description: "ISO code, e.g. USD" },
          city: { type: "string" },
          district: { type: "string", description: "Neighborhood or district" },
          url: { type: "string", description: "Absolute URL of the listing page" },
          imageUrl: { type: "string" },
          areaM2: { type: "number", description: "Built area in square meters" },
          bedrooms: { type: "number" },
          buildingAgeYears: { type: "number", description: "Building age in years, or derive from year built" },
        },
        required: ["title", "price"],
      },
    },
  },
  required: ["listings"],
} as const;

const VEHICLE_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          price: { type: "number", description: "Asking price as a plain number" },
          currency: { type: "string", description: "ISO code, e.g. USD" },
          city: { type: "string" },
          url: { type: "string", description: "Absolute URL of the listing page" },
          imageUrl: { type: "string" },
          make: { type: "string" },
          model: { type: "string" },
          year: { type: "number" },
          km: { type: "number", description: "Odometer in kilometers" },
          transmission: { type: "string" },
          fuel: { type: "string" },
        },
        required: ["title", "price"],
      },
    },
  },
  required: ["listings"],
} as const;

const PROMPTS: Record<AssetType, string> = {
  house:
    "Extract every residential property for sale on this page (houses and apartments). One item per listing. Skip ads, rentals and project teasers without a price.",
  vehicle:
    "Extract every used car for sale on this page. One item per listing. Skip ads, motorcycles and listings without a price.",
};

export function liveSourcesFor(type: AssetType): string[] {
  const raw = type === "house" ? process.env.FIRECRAWL_HOUSE_URLS : process.env.FIRECRAWL_VEHICLE_URLS;
  return (raw ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function liveEnabled(type: AssetType): boolean {
  return !!process.env.FIRECRAWL_API_KEY && process.env.FIRECRAWL_LIVE !== "off" && liveSourcesFor(type).length > 0;
}

function fillTemplate(tpl: string, q: LiveQuery) {
  const citySlug = q.city.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
  return tpl
    .replaceAll("{city}", encodeURIComponent(citySlug))
    .replaceAll("{minPrice}", String(Math.floor(q.minPrice)))
    .replaceAll("{maxPrice}", String(Math.ceil(q.maxPrice)));
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function normalize(type: AssetType, raw: Record<string, unknown>, q: LiveQuery, sourceUrl: string, i: number): Listing | null {
  const price = num(raw.price);
  const currency = (str(raw.currency) ?? "USD").toUpperCase();
  // Panama (balboa pegged 1:1, prices quoted in USD), Ecuador and El Salvador use USD.
  if (!price || (currency !== "USD" && currency !== "US$" && currency !== "$" && currency !== "B/.")) return null;
  const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  const url = str(raw.url);
  const base = {
    id: `live-${host}-${i}`,
    title: str(raw.title) ?? (type === "house" ? "Home for sale" : "Car for sale"),
    price,
    currency: "USD" as const,
    city: str(raw.city) ?? q.city,
    district: str(raw.district),
    url: url && /^https?:\/\//.test(url) ? url : null,
    imageUrl: str(raw.imageUrl),
    fetchedAt: new Date().toISOString(),
    source: host,
  };
  if (type === "house") {
    const l: HouseListing = { ...base, type: "house", areaM2: num(raw.areaM2), bedrooms: num(raw.bedrooms), buildingAgeYears: num(raw.buildingAgeYears) };
    return l;
  }
  const l: VehicleListing = {
    ...base,
    type: "vehicle",
    district: null,
    make: str(raw.make),
    model: str(raw.model),
    year: num(raw.year),
    km: num(raw.km),
    transmission: str(raw.transmission),
    fuel: str(raw.fuel),
  };
  return l;
}

async function scrapeOne(url: string, q: LiveQuery, signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
    body: JSON.stringify({
      url,
      onlyMainContent: true,
      formats: [{ type: "json", schema: q.type === "house" ? HOUSE_SCHEMA : VEHICLE_SCHEMA, prompt: PROMPTS[q.type] }],
    }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firecrawl ${res.status} for ${new URL(url).hostname}`);
  const body = (await res.json()) as { success?: boolean; data?: { json?: { listings?: unknown } } };
  const list = body.data?.json?.listings;
  return Array.isArray(list) ? (list.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}

/** Fetches live listings from every configured source in parallel. Throws if nothing usable comes back. */
export async function fetchLiveListings(q: LiveQuery, timeoutMs = Number(process.env.FIRECRAWL_TIMEOUT_MS ?? 15000)): Promise<Listing[]> {
  const sources = liveSourcesFor(q.type).map((tpl) => fillTemplate(tpl, q));
  const signal = AbortSignal.timeout(timeoutMs);
  const settled = await Promise.allSettled(sources.map((u) => scrapeOne(u, q, signal).then((rows) => ({ u, rows }))));
  const out: Listing[] = [];
  const errors: string[] = [];
  for (const s of settled) {
    if (s.status === "rejected") {
      errors.push(String((s.reason as Error)?.message ?? s.reason));
      continue;
    }
    s.value.rows.forEach((row, i) => {
      const l = normalize(q.type, row, q, s.value.u, i);
      if (l) out.push(l);
    });
  }
  if (out.length === 0) throw new Error(errors[0] ?? "Firecrawl returned no listings");
  return out;
}
