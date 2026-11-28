// Checks on live listing data: price parsing and the real-link guard. Pure (no server-only
// import) so scripts/check-prices.ts can test it.

/**
 * Drops extracted items whose URL is not one of the page's own links. On a page without
 * listings the extractor otherwise returns made-up ones (seen in testing with example.com).
 */
export function keepRealLinks(rows: Record<string, unknown>[], pageLinks: unknown[], pageUrl: string): Record<string, unknown>[] {
  const canon = (u: string) => {
    try {
      const x = new URL(u, pageUrl);
      return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "")).toLowerCase();
    } catch {
      return null;
    }
  };
  const real = new Set(pageLinks.filter((l): l is string => typeof l === "string").map(canon).filter((x): x is string => !!x));
  return rows.flatMap((r) => {
    if (typeof r.url !== "string") return [];
    const c = canon(r.url);
    if (!c || !real.has(c)) return [];
    // Store the absolute form so the card links to the real page.
    return [{ ...r, url: new URL(r.url, pageUrl).toString() }];
  });
}

// Panama quotes prices in USD or balboas (B/., pegged 1:1), with "," or "." as the thousands mark.

/** Currencies we accept as US dollars. Anything else is dropped rather than converted. */
const USD_LIKE = new Set(["USD", "US$", "$", "B/.", "B/", "PAB", "BALBOA", "BALBOAS", "DOLARES", "DÓLARES", "DOLLARS"]);

export function isUsdLike(currency: string | null | undefined): boolean {
  if (!currency) return true; // most pages don't say: Panama and Ecuador quote USD
  return USD_LIKE.has(currency.trim().toUpperCase());
}

/**
 * "$ 95,000" → 95000, "B/. 95.000" → 95000, "US$95k" → 95000, "1.2M" → 1200000,
 * "95,000.50" → 95000.5, "95.000,50" → 95000.5, 95000 → 95000. Unreadable or ≤ 0 → null.
 */
export function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;

  let s = v.toLowerCase().replace(/\s+/g, "");
  // Lead-in words dealers put before the figure: "Desde B/. 12,088.86", "From $95,000", "Precio: $…".
  s = s.replace(/^(desde|apartirde|from|precio|price|venta|sale)[:.]?/, "");
  // Currency words and symbols; "b/." before "$" so the dot isn't read as a decimal mark.
  s = s.replace(/^(us\$|usd\$?|b\/\.?|pab|\$)+/, "").replace(/(usd|us\$|pab|dólares|dolares|balboas?)$/, "");
  const m = /^([0-9][0-9.,]*)(k|mil|m|mm|millones?)?$/.exec(s);
  if (!m) return null;
  const [, digits, suffix] = m;

  const n = parseNumber(digits);
  if (n === null) return null;
  const mult = !suffix ? 1 : suffix === "k" || suffix === "mil" ? 1_000 : 1_000_000;
  const out = n * mult;
  return out > 0 ? Math.round(out * 100) / 100 : null;
}

/** Reads "95,000", "95.000", "95,000.50", "95.000,50", "1,250,000" and "1.25" alike. */
function parseNumber(d: string): number | null {
  const commas = (d.match(/,/g) ?? []).length;
  const dots = (d.match(/\./g) ?? []).length;
  let normalized: string;
  if (commas && dots) {
    // Both marks: the last one is the decimal mark.
    const decimal = d.lastIndexOf(",") > d.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = d.split(thousands).join("").replace(decimal, ".");
  } else if (commas || dots) {
    const mark = commas ? "," : ".";
    const parts = d.split(mark);
    // One mark repeated, or one mark followed by exactly three digits: thousands. Else decimal.
    const thousands = parts.length > 2 || parts[parts.length - 1].length === 3;
    normalized = thousands ? parts.join("") : parts.join(".");
  } else {
    normalized = d;
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
