import "server-only";
import seed from "@/data/listings.seed.json";
import type { AssetType } from "../types";
import { withComps } from "./comps";
import { RateLimitedError, fetchLiveListings, liveEnabled } from "./firecrawl";
import type { Listing, ListingWithComp, ListingsResponse } from "./types";

// İlan Bulucu backend: live Firecrawl call with a 15-minute cache, and the seed file as a
// fallback whenever live is off, slow, rate limited or empty. The demo never depends on live
// scraping. Scraped listings live only in this memory cache: never written to the repo or the seed.

const TTL_MS = 15 * 60 * 1000;
/** How many live listings just above the budget to return when none is under it. */
const ABOVE_BUDGET = 3;

/**
 * One entry per asset type and city, whatever the budget: the source page is the same for every
 * budget, so a new budget filters the cached page instead of asking the site again.
 */
const cache = new Map<string, { at: number; listings: Listing[] }>();
const keyOf = (type: AssetType, city: string) => `${type}|${city.trim().toLowerCase()}`;

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

/** Live listings for one budget: the ones under it, the closest few above it, and sample data if none fit. */
function liveResponse(q: ListingsQuery, base: Pick<ListingsResponse, "query">, all: Listing[], at: number, cached: boolean, note: string | null): ListingsResponse {
  const scored = withComps(all);
  const listings = scored.filter((l) => inRange(l, q));
  const aboveBudget = scored
    .filter((l) => l.price > q.maxPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, ABOVE_BUDGET);
  return {
    ...base,
    source: "live",
    cached,
    fetchedAt: new Date(at).toISOString(),
    note,
    listings,
    aboveBudget: listings.length === 0 ? aboveBudget : [],
    // Nothing live fits the budget: keep the example listings on screen, in their own labeled section.
    samples: listings.length === 0 ? sampleListings(q) : [],
  };
}

export async function findListings(q: ListingsQuery): Promise<ListingsResponse> {
  const base = { query: { type: q.type, city: q.city, minPrice: q.minPrice, maxPrice: q.maxPrice } };

  // Live only where configured (FIRECRAWL_LIVE_CITIES); other cities fall to sample data quietly.
  if (q.live && liveEnabled(q.type, q.city)) {
    const key = keyOf(q.type, q.city);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return liveResponse(q, base, hit.listings, hit.at, true, null);
    try {
      const listings = await fetchLiveListings({ type: q.type, city: q.city, minPrice: q.minPrice, maxPrice: q.maxPrice });
      const at = Date.now();
      cache.set(key, { at, listings });
      return liveResponse(q, base, listings, at, false, null);
    } catch (e) {
      if (e instanceof RateLimitedError) {
        // The source was asked under 10 s ago: an older copy is better than asking again.
        if (hit) return liveResponse(q, base, hit.listings, hit.at, true, null);
        return sample(q, base, "The live source was asked a moment ago (one request per 10 seconds); showing sample data.");
      }
      return sample(q, base, `Live search failed (${(e as Error).message}); showing sample data.`);
    }
  }

  // Live off (no key, no sources, or ?live=0): plain sample data, labeled in the UI.
  return sample(q, base, null);
}

function sampleListings(q: ListingsQuery): ListingWithComp[] {
  // Comps use every sample listing in the city, then the budget filter applies.
  return withComps(seedListings(q.type, q.city)).filter((l) => inRange(l, q));
}

function sample(q: ListingsQuery, base: Pick<ListingsResponse, "query">, note: string | null): ListingsResponse {
  return {
    ...base,
    source: "sample",
    cached: false,
    fetchedAt: (seed as { generatedAt: string }).generatedAt,
    note,
    listings: sampleListings(q),
    aboveBudget: [],
    samples: [],
  };
}
