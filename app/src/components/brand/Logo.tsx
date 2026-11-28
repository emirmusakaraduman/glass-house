import Link from "next/link";
import { cx } from "../ui";
import { LogoMark } from "./LogoMark";

// The full logo: GH emblem plus the "GLASS HOUSE" wordmark (GLASS 800, HOUSE 300, uppercase,
// 0.2em tracking) in Plus Jakarta Sans, the app's own font.

const SIZES = {
  sm: { mark: 24, text: "text-[12px]", gap: "gap-2" },
  md: { mark: 36, text: "text-[15px]", gap: "gap-2.5" },
  lg: { mark: 56, text: "text-[22px]", gap: "gap-3.5" },
} as const;

export type LogoSize = keyof typeof SIZES;

/** Emblem plus wordmark, or the emblem alone with `markOnly`. With `href` it is a link (named "GlassHouse home"). */
export function Logo({
  size = "md",
  markOnly = false,
  href,
  onClick,
  className,
}: {
  size?: LogoSize;
  markOnly?: boolean;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const s = SIZES[size];
  const body = (
    <>
      <LogoMark size={s.mark} />
      {markOnly ? null : (
        <span aria-hidden className={cx("whitespace-nowrap uppercase leading-none tracking-[0.2em] text-ink", s.text)}>
          <span className="font-extrabold">Glass</span>
          <span className="ml-[0.3em] font-light">House</span>
        </span>
      )}
    </>
  );
  const cls = cx("flex shrink-0 items-center", s.gap, className);
  if (href) {
    return (
      <Link href={href} onClick={onClick} aria-label="GlassHouse home" className={cx(cls, "rounded-lg")}>
        {body}
      </Link>
    );
  }
  return (
    <span role="img" aria-label="GlassHouse" className={cls}>
      {body}
    </span>
  );
}
