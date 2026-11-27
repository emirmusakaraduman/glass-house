import "server-only";
import seed from "@/data/listings.seed.json";
import type { AssetType } from "../types";
import { withComps } from "./comps";
import { fetchLiveListings, liveEnabled } from "./firecrawl";
import type { Listing, ListingsResponse } from "./types";

// İlan Bulucu backend: live Firecrawl call with a 15-minute cache, and the seed file as a
// fallback whenever live is off, slow or empty. The demo never depends on live scraping.

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; listings: Listing[] }>();

export interface ListingsQuery {
  type: AssetType;
  city: string;
  minPrice: number;
  maxPrice: number;
  /** false forces sample data (video rehearsals, demos without quota). */
  live: boolean;
}

export function seedListings(type: AssetType, city: string): Listing[] {
  return (seed.listings as Listing[]).filter((l) => l.type === type && l.city.toLowerCase() === city.toLowerCase());
}

function inRange(l: Listing, q: ListingsQuery) {
  return l.price >= q.minPrice && l.price <= q.maxPrice;
}

export async function findListings(q: ListingsQuery): Promise<ListingsResponse> {
  const base = { query: { type: q.type, city: q.city, minPrice: q.minPrice, maxPrice: q.maxPrice } };

  if (q.live && liveEnabled(q.type)) {
    // Bucket the price so nearby budgets share a cache entry and Firecrawl quota is protected.
    const key = [q.type, q.city.toLowerCase(), Math.floor(q.minPrice / 5000), Math.ceil(q.maxPrice / 5000)].join("|");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return { ...base, source: "live", cached: true, fetchedAt: new Date(hit.at).toISOString(), note: null, listings: withComps(hit.listings).filter((l) => inRange(l, q)) };
    }
    try {
      const listings = await fetchLiveListings({ type: q.type, city: q.city, minPrice: q.minPrice, maxPrice: q.maxPrice });
      cache.set(key, { at: Date.now(), listings });
      return { ...base, source: "live", cached: false, fetchedAt: new Date().toISOString(), note: null, listings: withComps(listings).filter((l) => inRange(l, q)) };
    } catch (e) {
      return sample(q, base, `Live search failed (${(e as Error).message}); showing sample data.`);
    }
  }

  // Live off (no key, no sources, or ?live=0): plain sample data, labeled in the UI.
  return sample(q, base, null);
}

function sample(q: ListingsQuery, base: Pick<ListingsResponse, "query">, note: string | null): ListingsResponse {
  // Comps use every sample listing in the city, then the budget filter applies.
  const all = withComps(seedListings(q.type, q.city));
  return {
    ...base,
    source: "sample",
    cached: false,
    fetchedAt: (seed as { generatedAt: string }).generatedAt,
    note,
    listings: all.filter((l) => inRange(l, q)),
  };
}
