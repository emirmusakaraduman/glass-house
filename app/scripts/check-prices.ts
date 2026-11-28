import { isUsdLike, keepRealLinks, parsePrice } from "../src/lib/listings/price";

// Unit tests for live-listing checks (price parser, real-link guard): npm run check:prices

const cases: [unknown, number | null][] = [
  ["$ 95,000", 95_000],
  ["B/. 95.000", 95_000],
  ["B/.95,000", 95_000],
  ["US$95k", 95_000],
  ["USD 95,000", 95_000],
  ["95.000 USD", 95_000],
  ["$1,250,000", 1_250_000],
  ["1.250.000", 1_250_000],
  ["$95,000.50", 95_000.5],
  ["95.000,50", 95_000.5],
  ["1.2M", 1_200_000],
  ["$ 18,900", 18_900],
  ["US$ 95,000", 95_000],
  ["$95.000", 95_000],
  ["B/. 95,000.00", 95_000],
  ["$ 100,500", 100_500],
  ["USD 20.300", 20_300],
  // Dealer and broker formats seen on the live sources
  ["Desde B/. 12,088.86", 12_088.86],
  ["From $95,000", 95_000],
  ["Precio: $314,845", 314_845],
  ["$300,000", 300_000],
  ["12.5k", 12_500],
  [95000, 95_000],
  ["Consultar", null],
  ["", null],
  ["$0", null],
  [-5, null],
  [null, null],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = parsePrice(input);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(input)} → ${got}${ok ? "" : ` (want ${want})`}`);
}

const currencies: [string | null, boolean][] = [["USD", true], ["usd", true], ["B/.", true], ["PAB", true], [null, true], ["EUR", false], ["COP", false]];
for (const [c, want] of currencies) {
  const ok = isUsdLike(c) === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} currency ${JSON.stringify(c)} → ${isUsdLike(c)}`);
}

// Real-link guard: only items whose URL is a link on the page survive.
const page = "https://listings.example/venta?max=100000";
const links = ["https://listings.example/propiedad/abc-123", "/propiedad/def-456/", "https://other.example/x"];
const rows = [
  { title: "real absolute", url: "https://www.listings.example/propiedad/abc-123" },
  { title: "real relative", url: "/propiedad/def-456" },
  { title: "invented", url: "https://listings.example/listing/2" },
  { title: "no url" },
];
const kept = keepRealLinks(rows, links, page).map((r) => `${r.title} ${r.url}`);
const wantKept = ["real absolute https://www.listings.example/propiedad/abc-123", "real relative https://listings.example/propiedad/def-456"];
const linksOk = JSON.stringify(kept) === JSON.stringify(wantKept);
if (!linksOk) failed++;
console.log(`${linksOk ? "ok  " : "FAIL"} keepRealLinks → ${JSON.stringify(kept)}`);
const emptyOk = keepRealLinks(rows, [], page).length === 0;
if (!emptyOk) failed++;
console.log(`${emptyOk ? "ok  " : "FAIL"} keepRealLinks with no page links → nothing kept`);

if (failed) {
  console.error(`\n${failed} price check(s) failed`);
  process.exit(1);
}
console.log("\nall price checks passed");
