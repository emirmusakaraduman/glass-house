// Writes src/data/listing-images.json: the listing ids that have a photo at public/listings/{id}.webp.
// ListingCard uses it to pick the photo without probing for missing files (no 404s in the console).
// Runs automatically before `npm run dev` and `npm run build`; run it by hand after adding photos.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "public", "listings");
const ids = existsSync(dir)
  ? readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".webp"))
      .map((f) => f.slice(0, -".webp".length))
      .sort()
  : [];

writeFileSync(join(process.cwd(), "src", "data", "listing-images.json"), JSON.stringify(ids, null, 2) + "\n");
console.log(`listing-images: ${ids.length} photo(s) in public/listings`);
