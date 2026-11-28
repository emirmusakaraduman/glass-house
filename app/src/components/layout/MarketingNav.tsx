"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "../ui";
import { Logo } from "../brand/Logo";
import { MARKETING_NAV, isNavActive } from "./routes";
import { ThemeChoices, ThemeSwitcher } from "./ThemeSwitcher";
import { DataSourceBadge, WalletButton } from "./WalletBits";

export function MarketingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-haze/[0.08] bg-frost/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] 2xl:max-w-[1400px] items-center gap-4 px-5 sm:px-8">
        <Logo href="/" onClick={() => setOpen(false)} />

        <nav aria-label="Main" className="hidden min-w-0 flex-1 justify-center lg:flex">
          <div className="flex items-center gap-1 rounded-full border border-haze/[0.08] bg-haze/[0.03] p-1">
          {MARKETING_NAV.map((l) => {
            const active = isNavActive(l, pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "rounded-full px-4 py-1.5 text-[14.5px] font-medium transition-colors",
                  active ? "nav-active bg-haze/[0.1] text-ink shadow-[inset_0_1px_0_rgb(var(--haze-rgb)/0.12),0_0_0_1px_rgb(125_230_255/calc(0.3*var(--glow)))]" : "text-muted hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
          </div>
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3 lg:ml-0">
          <DataSourceBadge hideOnMobile />
          <ThemeSwitcher className="hidden lg:block" />
          <WalletButton />
          <button
            className="rounded-full border border-haze/10 bg-haze/[0.04] p-2 lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="marketing-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="px-4 pb-4 lg:hidden">
          <nav id="marketing-menu" aria-label="Main" className="pane rounded-[20px] p-2">
            {MARKETING_NAV.map((l) => {
              const active = isNavActive(l, pathname);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx("block rounded-[12px] px-3.5 py-3 text-[16px] font-medium", active ? "nav-active bg-accent/20 text-ink" : "text-muted hover:bg-haze/[0.05] hover:text-ink")}
                >
                  {l.label}
                </Link>
              );
            })}
            <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-haze/[0.08] px-3.5 pb-1 pt-3">
              <ThemeChoices />
              <span className="sm:hidden">
                <DataSourceBadge />
              </span>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
