"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowRight, CircleCheck, FileSignature, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { WalletButton } from "@/components/layout/WalletBits";
import { useAction, useGlassHouse } from "@/components/providers/ClientProvider";
import { Button, ButtonLink, ErrorText, GlassCard, IconBadge, Note, Row, TxNote } from "@/components/ui";
import type { CosignRequest } from "@/lib/chain";
import { shortAddr, usd } from "@/lib/format";
import { POOLS } from "@/lib/pools";

// The seller opens the borrower's co-sign link here. The signed transaction rides in the URL
// fragment (#...), which browsers never send to the server.

export default function CosignPage() {
  const { client, version } = useGlassHouse();
  const { publicKey } = useWallet();
  const [payload, setPayload] = useState<string | null>(null);
  const [req, setReq] = useState<CosignRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const action = useAction();

  useEffect(() => {
    const read = () => setPayload(window.location.hash.slice(1) || null);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!payload || !client.describeCosign || sent) return;
    let alive = true;
    client
      .describeCosign(payload)
      .then((r) => alive && (setReq(r), setLoadError(null)))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [client, payload, version, sent]);

  const me = publicKey?.toBase58() ?? null;
  const wrongWallet = !!req && !!me && me !== req.seller;

  async function sign() {
    if (!payload || !client.cosignApplyLoan) return;
    const r = await action.run(() => client.cosignApplyLoan!(payload), { success: "Application signed and sent", failure: "Not sent" });
    if (r) setSent(r.loanKey);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <GlassCard className="space-y-5">
        <div className="flex items-start gap-3">
          <IconBadge icon={sent ? CircleCheck : FileSignature} tone={sent ? "ok" : "accent"} />
          <div>
            <h1 className="title text-2xl">{sent ? "Application sent" : "Co-sign a loan application"}</h1>
            <p className="mt-1 text-muted">
              {sent
                ? "The underwriter checks it next. You are paid from escrow after the title agent confirms the transfer."
                : "A buyer applied for a GlassHouse loan to buy from you. Check the terms, then sign with your seller wallet. You pay nothing."}
            </p>
          </div>
        </div>

        {client.mode !== "chain" || !client.describeCosign ? (
          <Note tone="warn">Co-sign links work when the app runs on the program (chain mode). This copy of the app uses demo data.</Note>
        ) : !payload ? (
          <Note tone="warn">This page needs the full link from the buyer. Ask them to send it again.</Note>
        ) : sent ? (
          <div className="space-y-3">
            {action.last ? <TxNote signature={action.last.signature} mock={action.last.mock} /> : null}
            <ButtonLink href={`/loans/${sent}`} variant="accent">
              Follow the loan <ArrowRight className="h-4 w-4" aria-hidden />
            </ButtonLink>
          </div>
        ) : loadError ? (
          <Note tone="bad">{loadError}</Note>
        ) : !req ? (
          <div className="flex items-center gap-2 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking the link…
          </div>
        ) : (
          <>
            <section aria-label="Terms" className="pane-flat p-4 text-[15px]">
              <Row k="Pool" v={POOLS[req.poolId].name} />
              <Row k="Sale price" v={usd(req.price, { cents: true })} strong />
              <Row k="Buyer's down payment" v={usd(req.downPayment, { cents: true })} />
              <Row k="Loan from the pool" v={usd(req.price - req.downPayment, { cents: true })} />
              <Row k="Buyer's wallet" v={<span className="font-mono text-sm">{shortAddr(req.borrower)}</span>} />
              <Row k="Your wallet" v={<span className="font-mono text-sm">{shortAddr(req.seller)}</span>} />
            </section>
            <p className="text-[13px] text-muted">
              This transaction only creates the application. The buyer pays the network fee and the down payment; you receive the sale price after the title is confirmed. Your wallet signs nothing else.
            </p>

            {req.problem ? <Note tone="warn">{req.problem}</Note> : null}
            {wrongWallet ? <Note tone="warn">This link is for the seller wallet {shortAddr(req.seller)}. The connected wallet is {shortAddr(me!)}. Switch wallets to sign.</Note> : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-haze/[0.08] pt-4">
              {!me ? <WalletButton /> : null}
              <Button onClick={sign} disabled={!me || wrongWallet || !!req.problem || action.pending}>
                {action.pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
                  </>
                ) : (
                  "Sign and send"
                )}
              </Button>
            </div>
            <ErrorText>{action.error}</ErrorText>
          </>
        )}
      </GlassCard>
    </div>
  );
}
