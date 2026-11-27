// Walks the demo story from the v4 doc ("Demo senaryosu") in one browser session and saves
// 1920x1080 screenshots to ../docs/screenshots for the video.
//
//   npm run build && npm run start -- -p 3123     (in another terminal)
//   npm run demo:screenshots                       (BASE_URL defaults to http://localhost:3123)
//
// The mock keeps its state in memory, so the script moves between pages with in-app links
// (no full reloads) and uses Playwright's clock to skip the demo "months" instead of waiting.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3123";
const OUT = join(process.cwd(), "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

let n = 0;
async function shot(page: Page, name: string, scrollY?: number) {
  if (scrollY !== undefined) await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.waitForTimeout(600);
  const file = `${String(n++).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  console.log("saved", file);
}

async function nav(page: Page, name: string, url: RegExp) {
  await page.getByRole("link", { name, exact: true }).first().click();
  await page.waitForURL(url);
  // Toasts from the previous page would cover this one's content in the shot.
  for (const b of await page.getByRole("button", { name: "Dismiss notification" }).all()) await b.click().catch(() => {});
  await page.waitForTimeout(800);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
  const page = await context.newPage();
  await page.clock.install();

  // 0. Landing
  await page.goto(BASE + "/");
  await page.getByRole("heading", { name: /GlassHouse/ }).first().waitFor();
  await shot(page, "landing");

  // a) Budget first, listing second: Maria in Panama City
  await nav(page, "Listings", /\/finder$/);
  await page.getByRole("button", { name: /Maria, home/ }).click();
  await page.getByRole("heading", { name: /homes in Panama City under \$100,531/ }).waitFor();
  await shot(page, "finder-maria");
  await shot(page, "finder-listings", 620);

  // Apply with "2-bedroom apartment with balcony"
  const card = page.locator("article", { hasText: "apartment with balcony" });
  // Six listings per page, highest price first: this one sits on the second page.
  if ((await card.count()) === 0) await page.getByRole("button", { name: /Show more listings/ }).click();
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Apply with this listing" }).click();
  await page.waitForURL(/\/apply$/);
  await page.getByRole("heading", { name: /Details/ }).waitFor();
  await shot(page, "apply-details", 0);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: /Financing/ }).waitFor();
  await shot(page, "apply-financing", 0);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: "Use the demo seller wallet" }).click();
  await shot(page, "apply-review", 0);
  await page.getByRole("button", { name: "Sign and send application" }).click();
  const sent = page.getByRole("heading", { name: /Application GH-\d+ sent/ });
  await sent.waitFor();
  const label = ((await sent.textContent()) ?? "").match(/GH-\d+/)?.[0] ?? "GH-0011";
  await shot(page, "application-sent", 0);

  // b) Underwriter approves, pool funds into escrow, title agent confirms: Active
  await page.getByRole("link", { name: `Track ${label}` }).click();
  await page.waitForURL(/\/loans\//);
  await page.getByRole("button", { name: "Approve", exact: true }).waitFor();
  await shot(page, "loan-pending");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await page.getByRole("button", { name: "Fund the loan" }).click();
  await page.getByText(/funded into escrow/).first().waitFor();
  await shot(page, "loan-in-escrow", 0);
  await page.getByRole("button", { name: "Confirm title" }).click();
  await page.locator("header").getByText("Active", { exact: true }).waitFor();
  await shot(page, "loan-active", 0);

  // c) Pay an installment; the share price steps up
  await page.getByRole("button", { name: /^Pay \$/ }).click();
  await page.getByText(/Installment paid on/).first().waitFor();
  await shot(page, "installment-paid", 0);
  await nav(page, "Dashboard", /\/invest$/);
  await shot(page, "invest-dashboard", 0);

  // d) GH-0006 misses payments; a stranger's check moves it to Late-2, then Defaulted
  await nav(page, "Loans", /\/transparency$/);
  await page.getByRole("link", { name: "GH-0006" }).first().click();
  await page.waitForURL(/\/loans\/house-6$/);
  // Missed periods come from the clock: (time past due and grace) / 60s + 1. Read how long the
  // loan has been past grace and jump to just after the next boundary, so it lands on Late-2
  // (a fixed jump could skip straight to Defaulted on a slow run).
  const overdue = await page.getByText("Overdue by", { exact: true }).locator("xpath=following-sibling::div[1]").textContent();
  const [m, s] = (overdue ?? "0:00").split(":").map(Number);
  const past = m * 60 + s;
  if (past < 60) await page.clock.fastForward((60 - past + 3) * 1000);
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Run the check" }).click();
  await page.locator("header").getByText(/Late, 2 missed/).waitFor();
  await shot(page, "gh0006-late2", 0);
  await page.clock.fastForward("01:00");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Run the check" }).click();
  await page.locator("header").getByText("Defaulted", { exact: true }).waitFor();
  await shot(page, "gh0006-defaulted", 0);

  // First-loss slab eats the provision; the investors' slab stays whole
  await nav(page, "Loans", /\/transparency$/);
  await shot(page, "transparency-loss-stack", 0);

  // e) Stress test: GlassHouse vs a 2008-style lender
  await nav(page, "Stress test", /\/stress$/);
  await shot(page, "stress-doc-scenario", 0);
  await page.locator("input.gh-range").first().fill("0.4");
  await shot(page, "stress-40-percent", 0);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
