// Re-creates src/data/listings.seed.json from the live Firecrawl sources, so the fallback
// set is a real snapshot instead of hand-made examples. The UI still labels it "Sample data".
// Needs FIRECRAWL_API_KEY and FIRECRAWL_HOUSE_URLS / FIRECRAWL_VEHICLE_URLS in .env.local.
// Run: npm run seed:listings
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchLiveListings, liveEnabled } from "../src/lib/listings/firecrawl";
import { CITIES, type Listing } from "../src/lib/listings/types";
import type { AssetType } from "../src/lib/types";

async function main() {
  const all: Listing[] = [];
  for (const type of ["house", "vehicle"] as AssetType[]) {
    if (!liveEnabled(type)) {
      console.warn(`skip ${type}: FIRECRAWL_API_KEY or source URLs missing`);
      continue;
    }
    for (const city of CITIES[type]) {
      try {
        const rows = await fetchLiveListings({ type, city, minPrice: 0, maxPrice: type === "house" ? 400_000 : 40_000 }, 60_000);
        console.log(`${type} / ${city}: ${rows.length}`);
        rows.forEach((r, i) => all.push({ ...r, id: `seed-${type[0]}-${city.replace(/\W+/g, "").toLowerCase()}-${i}` }));
      } catch (e) {
        console.warn(`${type} / ${city}: ${(e as Error).message}`);
      }
    }
  }
  if (all.length === 0) {
    console.error("Nothing fetched; the existing seed file was left as it is.");
    process.exit(1);
  }
  const out = {
    _note: `Snapshot exported from Firecrawl on ${new Date().toISOString()}. Shown in the UI with the 'Sample data' label, never as live listings.`,
    generatedAt: new Date().toISOString(),
    listings: all,
  };
  const file = resolve(__dirname, "../src/data/listings.seed.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`wrote ${all.length} listings to ${file}`);
}

main();
