"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { shortAddr } from "@/lib/format";
import { cx } from "../ui";
import { LogoLink } from "./Logo";
import { APP_NAV, isNavActive, pageMeta } from "./routes";
import { DataSourceBadge, ResetDemoButton, WalletButton, WalletCard, WalletStrip } from "./WalletBits";

/** Left sidebar on lg and up: logo, menu, wallet card. */
export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen p-3 pr-0 lg:block">
      <div className="pane flex h-full flex-col rounded-[24px] p-4">
        <LogoLink className="px-2 pb-6 pt-2" />
        <nav aria-label="App" className="flex-1">
          <ul className="space-y-1">
            {APP_NAV.map((item) => {
              const active = isNavActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[15px] font-medium transition-[background,color,box-shadow]",
                      active
                        ? "bg-[linear-gradient(135deg,rgb(0_210_255/0.45),rgb(0_210_255/0.2))] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_0_0_1px_rgb(125_230_255/0.35),0_8px_24px_-10px_rgb(0_210_255/0.8)]"
                        : "text-muted hover:bg-white/[0.05] hover:text-ink",
                    )}
                  >
                    <Icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-accent-light" : "")} aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <WalletCard />
      </div>
    </aside>
  );
}

/** Page title and one-line description on the left, data source and wallet on the right. */
export function AppTopBar() {
  const pathname = usePathname();
  const meta = pageMeta(pathname);
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58() ?? null;
  const title = address && meta.connectedTitle ? meta.connectedTitle : meta.title;
  return (
    <header className="border-b border-white/[0.08] bg-frost/70 backdrop-blur-xl lg:sticky lg:top-0 lg:z-20">
      <div className="mx-auto flex w-full max-w-[1200px] 2xl:max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3 sm:px-8 lg:flex-nowrap lg:py-4">
        <LogoLink withName={false} className="lg:hidden" />
        <div className="order-last min-w-0 basis-full lg:order-none lg:flex-1 lg:basis-auto">
          <h1 className="title text-gradient text-[22px] leading-tight sm:text-2xl">{title}</h1>
          {address && meta.connectedTitle ? (
            <p className="num mt-0.5 text-[13px] font-semibold text-steel" title={address}>
              {shortAddr(address)}
            </p>
          ) : null}
          {meta.lead ? <p className="mt-0.5 text-[14px] leading-snug text-muted lg:truncate">{meta.lead}</p> : null}
        </div>
        <WalletStrip className="order-last basis-full lg:hidden" />
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <DataSourceBadge />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

/** Fixed bottom tab bar below lg: the same five destinations as the sidebar. */
export function AppTabBar() {
  const pathname = usePathname();
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-frost/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto grid max-w-[560px] grid-cols-5">
        {APP_NAV.map((item) => {
          const active = isNavActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11.5px] font-semibold", active ? "text-ink" : "text-muted hover:text-ink")}
              >
                <span
                  className={cx(
                    "inline-flex h-8 w-12 items-center justify-center rounded-full transition-[background,box-shadow]",
                    active && "bg-accent/30 shadow-[0_0_0_1px_rgb(125_230_255/0.4),0_6px_18px_-6px_rgb(0_210_255/0.9)]",
                  )}
                >
                  <Icon className={cx("h-[18px] w-[18px]", active && "text-accent-light")} aria-hidden />
                </span>
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppContentFooter() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] 2xl:max-w-[1400px] justify-end px-5 pb-6 sm:px-8">
      <ResetDemoButton />
    </div>
  );
}
