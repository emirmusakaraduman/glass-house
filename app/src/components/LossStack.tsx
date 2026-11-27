"use client";

import { usd } from "@/lib/format";
import { cx } from "./ui";

// The signature visual: the loss order as a stack of glass panes. A loss enters at the top
// and eats through each pane before it can reach the next one. Investors are the last pane.

export interface LossLayer {
  name: string;
  /** Who holds this layer, in a few words. */
  owner: string;
  capacity: number;
  used: number;
  /** Investors' pane is drawn heavier. */
  senior?: boolean;
}

export function LossStack({ layers, caption }: { layers: LossLayer[]; caption?: string }) {
  return (
    <figure>
      <ol className="space-y-2">
        {layers.map((l, i) => {
          const usedShare = l.capacity > 0 ? Math.min(1, l.used / l.capacity) : l.used > 0 ? 1 : 0;
          const intact = Math.max(0, l.capacity - l.used);
          return (
            <li key={l.name} className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3">
              <span className="num inline-flex h-6 w-6 items-center justify-center justify-self-end rounded-full border border-accent-light/30 bg-accent/15 text-[12.5px] font-bold text-steel">{i + 1}</span>
              <div>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[14px]">
                  <span>
                    <span className="font-semibold">{l.name}</span>
                    <span className="ml-1.5 text-muted">{l.owner}</span>
                  </span>
                  <span className="num text-muted">
                    {l.used > 0 ? <span className="font-semibold text-bad-fg">{usd(l.used)} absorbed, </span> : null}
                    {usd(intact)} left
                  </span>
                </div>
                <div
                  className={cx(
                    "relative overflow-hidden rounded-[8px] border backdrop-blur",
                    l.senior
                      ? "h-6 border-accent-light/55 bg-[linear-gradient(90deg,rgb(0_210_255/0.55),rgb(125_230_255/0.35))] shadow-[0_0_18px_-4px_rgb(0_210_255/0.6)]"
                      : "h-4 border-accent-light/30 bg-[linear-gradient(90deg,rgb(0_210_255/0.3),rgb(125_230_255/0.16))]",
                  )}
                  role="img"
                  aria-label={`${l.name}: ${Math.round(usedShare * 100)}% used`}
                >
                  <div className="absolute inset-x-0 top-0 h-[40%] bg-white/[0.12]" aria-hidden />
                  {usedShare > 0 ? <div className="loss-hatch absolute inset-y-0 left-0 transition-[width] duration-700" style={{ width: `${usedShare * 100}%` }} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {caption ? <figcaption className="mt-3 pl-9 text-[13px] text-muted">{caption}</figcaption> : null}
    </figure>
  );
}
