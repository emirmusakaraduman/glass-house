"use client";

import { CircleAlert, CircleCheck, ExternalLink, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { explorerTx } from "@/lib/chain/anchor";

// Transaction feedback: glass toasts, bottom right, 5 seconds, dismissible, announced politely.
// The region is a manual popover so it sits in the top layer, above an open <dialog> as well.

export type ToastTone = "ok" | "info" | "bad";

export interface ToastInput {
  title: string;
  tone?: ToastTone;
  /** Transaction signature: mock ones say so, real ones link to Explorer. */
  signature?: string;
  mock?: boolean;
  detail?: string;
}

interface Toast extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);
const LIFETIME = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const region = useRef<HTMLDivElement>(null);

  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), LIFETIME);
    },
    [dismiss],
  );

  // Re-show the popover whenever toasts change so it stays above any modal opened since.
  useEffect(() => {
    const el = region.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (toasts.length) el.showPopover();
    } catch {
      // popover unsupported: the region still renders as a fixed element
    }
  }, [toasts]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        ref={region}
        popover="manual"
        role="status"
        aria-live="polite"
        className="gh-toasts fixed inset-auto bottom-24 right-4 m-0 w-[min(92vw,380px)] overflow-visible border-0 bg-transparent p-0 text-ink lg:bottom-6 lg:right-6"
      >
        <ul className="flex flex-col gap-2">
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
          ))}
        </ul>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const tone = toast.tone ?? "ok";
  const Icon = tone === "bad" ? CircleAlert : tone === "info" ? Info : CircleCheck;
  return (
    <li
      className={
        "gh-toast flex gap-3 rounded-[16px] border bg-[rgb(var(--glass-rgb)/0.92)] p-3.5 shadow-[inset_0_1px_0_rgb(var(--haze-rgb)/0.08),0_20px_40px_-16px_rgb(0_0_0/calc(0.8*var(--glow)))] backdrop-blur-xl " +
        (tone === "bad" ? "border-bad/45" : tone === "info" ? "border-accent-light/35" : "border-ok/40")
      }
    >
      <Icon className={"mt-0.5 h-5 w-5 shrink-0 " + (tone === "bad" ? "text-bad-fg" : tone === "info" ? "text-steel" : "text-ok")} aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">{toast.title}</p>
        {toast.detail ? <p className="mt-0.5 text-muted">{toast.detail}</p> : null}
        {toast.signature ? (
          toast.mock ? (
            <p className="mt-0.5 text-muted">Mock transaction, no Explorer page.</p>
          ) : (
            <a href={explorerTx(toast.signature)} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 font-semibold text-steel underline-offset-2 hover:underline">
              View on Solana Explorer <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )
        ) : null}
      </div>
      <button onClick={onClose} aria-label="Dismiss notification" className="-mr-1 -mt-1 h-7 w-7 shrink-0 rounded-full text-muted hover:bg-haze/10 hover:text-ink">
        <X className="mx-auto h-4 w-4" aria-hidden />
      </button>
    </li>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
