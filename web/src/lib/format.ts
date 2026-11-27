export function usd(n: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (!Number.isFinite(n)) return "–";
  if (opts.compact && Math.abs(n) >= 10_000) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(n);
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "–";
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

export function shortHash(h: string | null | undefined): string {
  if (!h) return "–";
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function bandLabel(lo: number, hi: number): string {
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));
  return `$${k(lo)}–${k(hi)}`;
}

/** "in 34s", "12s ago", "3 days ago" */
export function relTime(at: number, now = Date.now()): string {
  const d = Math.round((at - now) / 1000);
  const abs = Math.abs(d);
  const unit = abs < 90 ? `${abs}s` : abs < 5400 ? `${Math.round(abs / 60)} min` : abs < 129600 ? `${Math.round(abs / 3600)} h` : `${Math.round(abs / 86400)} days`;
  return d >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function dateTime(at: number): string {
  return new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
