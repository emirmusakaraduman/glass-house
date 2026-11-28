"use client";

import { Logo } from "../brand/Logo";
import { ResetDemoButton } from "./WalletBits";

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.08]">
      <div className="mx-auto flex w-full max-w-[1200px] 2xl:max-w-[1400px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted sm:px-8">
        <div className="max-w-[70ch] space-y-3">
          <Logo href="/" />
          <p>
            Hackathon demo on Solana devnet with test USDC. A licensed lender would originate real loans; collateral is registered to an SPV. No personal data is written on-chain.
          </p>
        </div>
        <ResetDemoButton />
      </div>
    </footer>
  );
}
