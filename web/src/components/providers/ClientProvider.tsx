"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DATA_SOURCE, MockClient, type GlassHouseClient } from "@/lib/chain";
import { useToast, type ToastTone } from "./ToastProvider";

// Holds the single GlassHouseClient for the app. Mock today; the chain client plugs in here
// once the IDL exists (see src/lib/chain/anchor.ts).

interface Ctx {
  client: GlassHouseClient;
  /** Bumps whenever data changes, so hooks refetch. */
  version: number;
  resetDemo: (() => void) | null;
}

const ClientContext = createContext<Ctx | null>(null);

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useWallet();
  const mockRef = useRef<MockClient | null>(null);
  if (!mockRef.current) mockRef.current = new MockClient();
  const client = mockRef.current;
  const [version, setVersion] = useState(0);

  useEffect(() => client.subscribe(() => setVersion((v) => v + 1)), [client]);
  useEffect(() => client.setActor(publicKey?.toBase58() ?? null), [client, publicKey]);

  const resetDemo = useCallback(() => client.reset(), [client]);
  const value = useMemo<Ctx>(() => ({ client, version, resetDemo: DATA_SOURCE === "mock" ? resetDemo : null }), [client, version, resetDemo]);

  useEffect(() => {
    // TODO(IDL): build the chain client here and drop the mock.
    if (DATA_SOURCE === "chain") console.warn("NEXT_PUBLIC_DATA_SOURCE=chain is set but the chain client isn't wired yet; using mock data.");
  }, []);

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useGlassHouse(): Ctx {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useGlassHouse must be used inside <ClientProvider>");
  return ctx;
}

/**
 * Loads data through the client and refetches when it changes. `pollMs` keeps time-based
 * views (due dates, crankable loans, autopay in mock mode) fresh.
 */
export function useChainQuery<T>(fn: (c: GlassHouseClient) => Promise<T>, deps: unknown[], pollMs = 3000) {
  const { client, version } = useGlassHouse();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => setTick((t) => t + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  useEffect(() => {
    let alive = true;
    fnRef
      .current(client)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, version, tick, ...deps]);

  return { data, error, loading: data === null && error === null };
}

type Outcome = string | { title: string; tone?: ToastTone };

/**
 * Runs a write and tracks pending/error/result for buttons. With `success`, the result is also
 * shown as a toast, and the same text becomes `last.message` so inline notes say the same thing.
 * Failures with `success` set are toasted too.
 */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ signature: string; mock: boolean; message?: string } | null>(null);
  const run = useCallback(
    async <R extends { signature: string; mock: boolean; message?: string }>(fn: () => Promise<R>, opts?: { success?: Outcome | ((r: R) => Outcome); failure?: string }) => {
      setPending(true);
      setError(null);
      try {
        const r = await fn();
        const out = typeof opts?.success === "function" ? opts.success(r) : opts?.success;
        const o = typeof out === "string" ? { title: out } : out;
        setLast(o ? { ...r, message: o.title } : r);
        if (o) toast({ title: o.title, tone: o.tone ?? "ok", signature: r.signature, mock: r.mock });
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        if (opts?.success !== undefined) toast({ title: opts.failure ?? "That didn't go through", detail: msg, tone: "bad" });
        return null;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { run, pending, error, last, clear: () => (setError(null), setLast(null)) };
}
