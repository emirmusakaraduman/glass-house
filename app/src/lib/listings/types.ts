import type { AssetType } from "../types";

// Listing fields from the v4 doc ("İlan Bulucu", alan tablosu).

interface ListingBase {
  id: string;
  type: AssetType;
  title: string;
  price: number;
  currency: "USD";
  city: string;
  district: string | null;
  /** Listing page. Never written on-chain; only a salted hash and the value band are. */
  url: string | null;
  imageUrl: string | null;
  /** ISO time the listing was fetched. */
  fetchedAt: string;
  /** Site name, or "sample" for the seed file. */
  source: string;
}

export interface HouseListing extends ListingBase {
  type: "house";
  areaM2: number | null;
  bedrooms: number | null;
  buildingAgeYears: number | null;
}

export interface VehicleListing extends ListingBase {
  type: "vehicle";
  make: string | null;
  model: string | null;
  year: number | null;
  km: number | null;
  transmission: string | null;
  fuel: string | null;
}

export type Listing = HouseListing | VehicleListing;

/** Comparable-listings signal. A helper for the underwriter, never a valuation. */
export interface CompSignal {
  basis: "price_per_m2" | "model_year";
  /** Median of comparable listings (per m² for houses, price for cars). */
  median: number | null;
  peers: number;
  /** How far this listing sits above/below the median, 0.2 = 20% above. */
  delta: number | null;
  /** True when more than 15% above the median. */
  flagged: boolean;
}

export type ListingWithComp = Listing & { comp: CompSignal };

export interface ListingsResponse {
  /** "live" = fetched with Firecrawl now (or from the 15-minute cache); "sample" = listings.seed.json. */
  source: "live" | "sample";
  cached: boolean;
  fetchedAt: string;
  /** Why the response fell back to sample data, if it did. */
  note: string | null;
  query: { type: AssetType; city: string; minPrice: number; maxPrice: number };
  listings: ListingWithComp[];
  /** Live only, when nothing live is under the budget: the closest listings above it (at most 3). */
  aboveBudget: ListingWithComp[];
  /** Live only, when nothing live is under the budget: sample listings under it, shown apart. */
  samples: ListingWithComp[];
}

export const CITIES: Record<AssetType, string[]> = {
  house: ["Panama City", "Guayaquil"],
  vehicle: ["Panama City", "Guayaquil"],
};
