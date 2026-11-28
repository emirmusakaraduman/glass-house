import { readFileSync } from "node:fs";
import { join } from "node:path";

// WCAG contrast of the theme tokens, read straight from src/app/globals.css (the dark and light
// [data-theme] blocks), so the check can't drift from the real values. Translucent colors are
// composited over what they sit on. Run: npm run check:contrast

type RGBA = [number, number, number, number];

const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  // The token block is the one that also sets color-scheme.
  const start = css.indexOf(`\n${selector} {\n  color-scheme`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function parse(c: string): RGBA {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = c.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([0-9.]+))?\)$/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] ? +rgb[4] : 1];
  throw new Error(`can't read color ${c}`);
}

const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
};
const lum = ([r, g, b]: RGBA) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// Glass surfaces as the .pane class draws them (globals.css): dark #131C31 at 70%, light white at 85%.
const SURFACE = { dark: "rgb(19 28 49 / 0.7)", light: "rgb(255 255 255 / 0.85)" };
const GOLD = "#f59e0b";

let failed = 0;
for (const theme of ["dark", "light"] as const) {
  const t = block(`[data-theme="${theme}"]`);
  const bg = parse(t.frost);
  const surface = over(parse(SURFACE[theme]), bg);
  const on = (fg: string, base: RGBA) => over(parse(fg), base);
  const rows: [string, number, number][] = [];
  const add = (label: string, fg: string, base: RGBA, min = 4.5) => rows.push([label, ratio(on(fg, base), base), min]);
  for (const [name, base] of [
    ["bg", bg],
    ["surface", surface],
  ] as const) {
    add(`text on ${name}`, t.ink, base);
    add(`text-muted on ${name}`, t.muted, base);
    add(`accent-ink on ${name}`, t["accent-ink"], base);
    add(`ok on ${name}`, t.ok, base);
    add(`warn on ${name}`, t.warn, base);
    // Red text uses bad-fg; bad itself is for borders, fills and icons (3:1).
    add(`bad-fg (red text) on ${name}`, t["bad-fg"], base);
    add(`bad (icons, fills) on ${name}`, t.bad, base, 3);
    add(`indigo on ${name}`, t.indigo, base);
  }
  // Status text on its own soft badge background.
  add("ok on ok-soft", t.ok, over(parse(t["ok-soft"]), surface));
  add("warn on warn-soft", t.warn, over(parse(t["warn-soft"]), surface));
  add("bad-fg on bad-soft", t["bad-fg"], over(parse(t["bad-soft"]), surface));
  add("gold-ink on gold (main button)", "#0b1120", parse(GOLD));
  add("focus ring (accent) on bg, 3:1", theme === "light" ? "#0e7490" : t["accent-ink"], bg, 3);

  console.log(`\n${theme.toUpperCase()}`);
  for (const [label, r, min] of rows) {
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(36)} ${r.toFixed(2)}:1${min !== 4.5 ? `  (needs ${min}:1)` : ""}`);
  }
}

if (failed) {
  console.error(`\n${failed} contrast pair(s) below the minimum`);
  process.exit(1);
}
console.log("\nall contrast pairs pass");
