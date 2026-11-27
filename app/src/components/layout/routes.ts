import { Activity, Eye, FilePen, LayoutDashboard, Search, type LucideIcon } from "lucide-react";

// One map for navigation and page titles, so the sidebar, the mobile tab bar and the
// top bar can't drift apart. URLs are the same as before the route groups.

export interface AppNavItem {
  href: string;
  label: string;
  /** Label under the icon in the mobile tab bar. */
  short: string;
  icon: LucideIcon;
  /** Other path prefixes that count as this item (loan pages belong to Loans). */
  also?: string[];
}

export const APP_NAV: AppNavItem[] = [
  { href: "/invest", label: "Dashboard", short: "Dashboard", icon: LayoutDashboard },
  { href: "/finder", label: "Listing finder", short: "Finder", icon: Search },
  { href: "/apply", label: "Apply", short: "Apply", icon: FilePen },
  { href: "/transparency", label: "Loans", short: "Loans", icon: Eye, also: ["/loans"] },
  { href: "/stress", label: "Stress test", short: "Stress", icon: Activity },
];

export const MARKETING_NAV = [
  { href: "/", label: "Home" },
  { href: "/finder", label: "Listings" },
  { href: "/transparency", label: "Loans" },
  { href: "/invest", label: "Investors" },
  { href: "/stress", label: "Stress test" },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isNavActive(item: { href: string; also?: string[] }, pathname: string) {
  if (item.href === "/") return pathname === "/";
  return [item.href, ...(item.also ?? [])].some((p) => under(pathname, p));
}

/** Title and one-line description shown in the app top bar. */
/** `connectedTitle` replaces the title while a wallet is connected (the address is shown under it). */
const PAGE_META: { prefix: string; title: string; lead: string; connectedTitle?: string }[] = [
  { prefix: "/invest", title: "Investor dashboard", connectedTitle: "Welcome, investor", lead: "Every loan behind your shares is public." },
  { prefix: "/finder", title: "What can I buy?", lead: "Budget first, listings second. Your income and savings never leave this browser." },
  { prefix: "/apply", title: "Apply for a loan", lead: "Every cost is on this page before you sign. Income is checked off-chain; only loan terms go on-chain." },
  { prefix: "/transparency", title: "Every loan, in the open", lead: "Each loan is its own Solana account. Terms, payments and provisions are public; borrowers are not." },
  { prefix: "/loans", title: "Loan detail", lead: "One loan's terms, payments and status. Anyone can flag a missed payment." },
  { prefix: "/stress", title: "What happens in a crash", lead: "Let loans default, drop prices and follow the loss through every layer." },
];

export function pageMeta(pathname: string) {
  return PAGE_META.find((m) => under(pathname, m.prefix)) ?? { title: "GlassHouse", lead: "", connectedTitle: undefined };
}
