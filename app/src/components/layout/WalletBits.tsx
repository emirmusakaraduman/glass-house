"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { AlertTriangle, RotateCcw, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { DATA_SOURCE } from "@/lib/chain";
import { num, shortAddr } from "@/lib/format";
import { useChainQuery, useGlassHouse } from "../providers/ClientProvider";
import { cx } from "../ui";

export const WalletButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
  loading: () => <div className="h-10 w-[140px] rounded-full bg-haze/[0.06]" />,
});

/** "Mock data" while the IDL isn't wired, "Devnet" once it is. `hideOnMobile` hides it below sm. */
export function DataSourceBadge({ hideOnMobile }: { hideOnMobile?: boolean }) {
  const display = hideOnMobile ? "hidden sm:inline-flex" : "inline-flex";
  return DATA_SOURCE === "mock" ? (
    <span
      className={cx(display, "shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[13px] font-semibold text-warn")}
      title="In-memory demo data until the program IDL is wired"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      Mock data
    </span>
  ) : (
    <span className={cx(display, "shrink-0 items-center whitespace-nowrap rounded-full border border-accent-light/35 bg-accent/10 px-2.5 py-0.5 text-[13px] font-semibold text-steel")}>
      Devnet
    </span>
  );
}

/** Sidebar card: who is acting and how much USDC they hold. */
export function WalletCard() {
  const { connected } = useWallet();
  const { client } = useGlassHouse();
  const actor = client.actor;
  const { data: balance } = useChainQuery((c) => c.getWalletBalance(c.actor), [actor]);
  const unit = client.mode === "mock" ? "test USDC" : "USDC";

  return (
    <div className="pane-flat pane-highlight p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="dense inline-flex items-center gap-1.5 text-[13px] text-muted">
          <Wallet className="h-3.5 w-3.5" aria-hidden />
          Wallet
        </span>
        <span className="num text-[12.5px] text-muted" title={actor}>
          {actor ? shortAddr(actor) : "–"}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="num text-xl font-extrabold tracking-tight">{balance === null || !actor ? "–" : num(balance, 2)}</span>
        <span className="text-[13px] font-semibold text-muted">{unit}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[13px]">
        <span className={cx("h-2 w-2 rounded-full", connected ? "bg-ok shadow-[0_0_8px_rgb(52_211_153/calc(0.8*var(--glow)))]" : "bg-steel-soft")} aria-hidden />
        <span className={connected ? "font-semibold text-ok" : "text-muted"}>{walletLabel(connected, client.mode)}</span>
      </div>
    </div>
  );
}

/** Below lg the sidebar (and its wallet card) is hidden: one compact line with the same balance. */
export function WalletStrip({ className }: { className?: string }) {
  const { connected } = useWallet();
  const { client } = useGlassHouse();
  const actor = client.actor;
  const { data: balance } = useChainQuery((c) => c.getWalletBalance(c.actor), [actor]);
  const unit = client.mode === "mock" ? "test USDC" : "USDC";

  return (
    <div className={cx("pane-flat flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-2 text-[13px]", className)}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted">
        <span className={cx("h-2 w-2 shrink-0 rounded-full", connected ? "bg-ok shadow-[0_0_8px_rgb(52_211_153/calc(0.8*var(--glow)))]" : "bg-steel-soft")} aria-hidden />
        <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{walletLabel(connected, client.mode)}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="num text-[15px] font-extrabold tracking-tight text-ink">{balance === null || !actor ? "–" : num(balance, 2)}</span>
        <span className="font-semibold text-muted">{unit}</span>
      </span>
    </div>
  );
}

/** Small "Reset demo data" control; renders nothing outside mock mode. */
export function ResetDemoButton({ className }: { className?: string }) {
  const { resetDemo } = useGlassHouse();
  if (!resetDemo) return null;
  return (
    <button onClick={resetDemo} className={cx("inline-flex items-center gap-1.5 rounded-full text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline", className)}>
      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
      Reset demo data
    </button>
  );
}

/** Mock mode signs with a built-in demo wallet; chain mode needs a real one connected. */
function walletLabel(connected: boolean, mode: "mock" | "chain") {
  if (connected) return "Connected";
  return mode === "mock" ? "Demo wallet" : "Not connected";
}
