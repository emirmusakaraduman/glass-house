import type { CompSignal, Listing, ListingWithComp } from "./types";

// "Emsal sinyali": median of similar listings. Shown to the underwriter as a warning when a
// listing is more than 15% above it. The signed appraisal still sets the value; the program
// checks LTV against min(sale price, signed value).

export const COMP_THRESHOLD = 0.15;
const MIN_PEERS = 2;

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function houseMetric(l: Listing): number | null {
  return l.type === "house" && l.areaM2 && l.areaM2 > 0 ? l.price / l.areaM2 : null;
}

function signal(basis: CompSignal["basis"], value: number | null, peerValues: number[]): CompSignal {
  if (value === null || peerValues.length < MIN_PEERS) return { basis, median: null, peers: peerValues.length, delta: null, flagged: false };
  const m = median(peerValues)!;
  const delta = value / m - 1;
  return { basis, median: m, peers: peerValues.length, delta, flagged: delta > COMP_THRESHOLD };
}

/** Comps are computed inside the result set: same district for homes, same make/model ±1 year for cars. */
export function withComps(listings: Listing[]): ListingWithComp[] {
  return listings.map((l) => {
    if (l.type === "house") {
      const peers = listings.filter(
        (o) => o.id !== l.id && o.type === "house" && o.city === l.city && !!o.district && o.district === l.district,
      );
      return { ...l, comp: signal("price_per_m2", houseMetric(l), peers.map(houseMetric).filter((x): x is number => x !== null)) };
    }
    const peers = listings.filter(
      (o) =>
        o.id !== l.id &&
        o.type === "vehicle" &&
        !!l.make &&
        !!l.model &&
        l.year !== null &&
        o.make?.toLowerCase() === l.make.toLowerCase() &&
        o.model?.toLowerCase() === l.model.toLowerCase() &&
        o.year !== null &&
        Math.abs(o.year - l.year) <= 1,
    );
    return { ...l, comp: signal("model_year", l.price, peers.map((p) => p.price)) };
  });
}
