"use client";

import Link from "next/link";
import { useId } from "react";
import { cx } from "../ui";

/** A house outline made of four panes: the product's one idea, transparency. Cyan gradient. */
export function Logo({ className }: { className?: string }) {
  const id = useId();
  const g = `url(#${id})`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cx("drop-shadow-[0_0_10px_rgb(0_210_255/0.55)]", className)}>
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e0f7ff" />
          <stop offset="0.55" stopColor="#7de6ff" />
          <stop offset="1" stopColor="#0094b8" />
        </linearGradient>
      </defs>
      <path d="M4 14 L16 4 L28 14" fill="none" stroke={g} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="7" y="14" width="8" height="6.5" fill={g} opacity="0.3" />
      <rect x="17" y="14" width="8" height="6.5" fill={g} opacity="0.55" />
      <rect x="7" y="21.5" width="8" height="6.5" fill={g} opacity="0.55" />
      <rect x="17" y="21.5" width="8" height="6.5" fill={g} opacity="0.3" />
      <rect x="6" y="13" width="20" height="16" rx="1" fill="none" stroke={g} strokeWidth="2" />
    </svg>
  );
}

export function LogoLink({ withName = true, onClick, className }: { withName?: boolean; onClick?: () => void; className?: string }) {
  return (
    <Link href="/" onClick={onClick} aria-label={withName ? undefined : "GlassHouse home"} className={cx("flex shrink-0 items-center gap-2 rounded-full text-ink", className)}>
      <Logo className="h-7 w-7" />
      {withName ? <span className="display text-[20px]">GlassHouse</span> : null}
    </Link>
  );
}
