"use client";

import { AlertTriangle, Check, CircleAlert, ExternalLink, Info, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- surfaces

export function Pane({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("pane p-5 sm:p-6", className)} {...rest}>
      {children}
    </section>
  );
}

type GlassVariant = "default" | "highlight" | "glow";

/** Glass surface. `highlight` tints it cyan; `glow` adds a soft cyan halo for the one key card on a screen. */
export function GlassCard({ variant = "default", className, children, ...rest }: ComponentProps<"div"> & { variant?: GlassVariant }) {
  return (
    <div className={cx("pane p-5 sm:p-6", variant !== "default" && "pane-highlight", variant === "glow" && "pane-glow", className)} {...rest}>
      {children}
    </div>
  );
}

export function PaneTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="title text-lg">{children}</h2>
      {aside ? <div className="text-sm text-muted">{aside}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- numbers

const TONE_TEXT = { ok: "text-ok", warn: "text-warn", bad: "text-bad-fg" } as const;

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="min-w-0">
      <div className="dense text-[13px] text-muted">{label}</div>
      <div className={cx("num mt-1 text-xl font-bold tracking-tight", tone && TONE_TEXT[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-[13px] text-muted">{hint}</div> : null}
    </div>
  );
}

/** Label, big value, small note underneath, and a slot on the right (sparkline, icon). */
export function KpiCard({
  label,
  value,
  hint,
  tone,
  icon,
  aside,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  icon?: LucideIcon;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("pane flex min-w-0 items-end justify-between gap-4 p-4 sm:p-5", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <IconBadge icon={icon} size="sm" /> : null}
          <span className="dense text-[13px] leading-snug text-muted">{label}</span>
        </div>
        <div className={cx("num mt-2 text-[28px] font-extrabold leading-none tracking-tight", tone && TONE_TEXT[tone])}>{value}</div>
        {hint ? <div className="mt-2 text-[13px] text-muted">{hint}</div> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------- actions

/**
 * primary = gold: only the one main action on a screen. accent = important but not the main action.
 * quiet = glass with a cyan edge. danger = destructive or alarming.
 */
type BtnProps = ComponentProps<"button"> & { variant?: "primary" | "accent" | "quiet" | "danger"; size?: "md" | "sm" };

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background,box-shadow,border-color,color] disabled:cursor-not-allowed disabled:opacity-45";
const BTN_VARIANT = {
  primary: "btn-gold",
  accent: "btn-accent",
  quiet: "border border-accent/30 bg-[rgb(19_28_49/0.7)] text-ink backdrop-blur hover:border-accent/60 hover:bg-accent/10",
  danger: "border border-bad/45 bg-bad/10 text-bad-fg hover:border-bad/75 hover:bg-bad/15",
} as const;

export function Button({ variant = "primary", size = "md", className, ...rest }: BtnProps) {
  return <button className={cx(BTN_BASE, size === "md" ? "h-11 px-5 text-[15px]" : "h-9 px-4 text-sm", BTN_VARIANT[variant], className)} {...rest} />;
}

export function ButtonLink({ href, variant = "primary", className, children }: { href: string; variant?: "primary" | "accent" | "quiet"; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cx(BTN_BASE, "h-11 px-6 text-[15px]", BTN_VARIANT[variant], className)}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- inputs

const INPUT_SHELL =
  "h-11 w-full rounded-[12px] border border-white/12 bg-white/[0.04] text-[15px] text-ink transition-[border-color,box-shadow] placeholder:text-muted hover:border-white/20";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="dense text-[13px] text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <span className="mt-1 block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

/** `autoFocus` marks the field for Modal to focus when it opens. */
export function MoneyInput({ value, onChange, min = 0, step = 100, ariaLabel, autoFocus }: { value: number; onChange: (v: number) => void; min?: number; step?: number; ariaLabel?: string; autoFocus?: boolean }) {
  return (
    <div className={cx(INPUT_SHELL, "flex items-center px-3.5 focus-within:border-accent-light/70 focus-within:shadow-[0_0_0_3px_rgb(0_210_255/0.35)]")}>
      <span className="mr-1.5 text-muted">$</span>
      <input
        aria-label={ariaLabel}
        data-autofocus={autoFocus ? "" : undefined}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="num w-full bg-transparent text-[16px] font-medium outline-none"
      />
    </div>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cx(INPUT_SHELL, "px-3.5 outline-none focus-visible:border-accent-light/70 focus-visible:shadow-[0_0_0_3px_rgb(0_210_255/0.35)]", props.className)}
    />
  );
}

/** Pill tabs, like the Home / Car switch. */
/** `icon` on an option is optional (lucide icon shown before the label). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: LucideIcon }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-full border border-white/10 bg-white/[0.04] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-[background,color]",
            value === o.value ? "fill-accent" : "text-muted hover:bg-white/[0.06] hover:text-ink",
          )}
        >
          {o.icon ? <o.icon className="h-4 w-4" aria-hidden /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- messages and badges

const NOTE = {
  info: { cls: "border-accent-light/25 bg-accent/10", icon: Info, iconCls: "text-steel" },
  warn: { cls: "border-warn/30 bg-warn/[0.08]", icon: AlertTriangle, iconCls: "text-warn" },
  bad: { cls: "border-bad/35 bg-bad/10", icon: CircleAlert, iconCls: "text-bad-fg" },
} as const;

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "bad"; children: ReactNode }) {
  const n = NOTE[tone];
  const Icon = n.icon;
  return (
    <div className={cx("flex gap-2.5 rounded-[12px] border px-3.5 py-3 text-sm leading-relaxed text-ink", n.cls)}>
      <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", n.iconCls)} aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SampleDataBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[13px] font-semibold text-warn"
      title="Example listings from listings.seed.json, not live offers"
    >
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      Sample data
    </span>
  );
}

const ICON_TONE = {
  accent: "border-accent/30 bg-[linear-gradient(135deg,rgb(0_210_255/0.22),rgb(0_210_255/0.06))] text-accent",
  indigo: "border-indigo/30 bg-indigo/10 text-indigo",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  bad: "border-bad/30 bg-bad/10 text-bad-fg",
} as const;

const ICON_SIZE = { sm: ["h-7 w-7 rounded-[9px]", "h-3.5 w-3.5"], md: ["h-10 w-10 rounded-[12px]", "h-5 w-5"], lg: ["h-12 w-12 rounded-[14px]", "h-6 w-6"] } as const;

/** Lucide icon on a tinted glass square (cyan by default), like the feature icons in the hero. */
export function IconBadge({ icon: Icon, size = "md", tone = "accent", label, className }: { icon: LucideIcon; size?: "sm" | "md" | "lg"; tone?: keyof typeof ICON_TONE; label?: string; className?: string }) {
  const [box, glyph] = ICON_SIZE[size];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center border shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]", box, ICON_TONE[tone], className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon className={glyph} strokeWidth={2} />
    </span>
  );
}

/**
 * Numbered steps with a line between them. `current` is 0-based; earlier steps show a check.
 * With `onStepClick`, completed steps become buttons that go back to that step.
 */
export function Stepper({
  steps,
  current,
  className,
  onStepClick,
}: {
  steps: { label: string; hint?: string; tag?: { text: string; tone: "warn" | "bad" } }[];
  current: number;
  className?: string;
  onStepClick?: (index: number) => void;
}) {
  return (
    <ol className={cx("flex w-full items-start", className)}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.label} className="relative flex min-w-0 flex-1 flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {i > 0 ? (
              <span
                className={cx("absolute left-[calc(-50%+24px)] right-[calc(50%+24px)] top-4 h-0.5 rounded-full", i <= current ? "bg-accent-gradient" : "bg-white/12")}
                aria-hidden
              />
            ) : null}
            {(() => {
              const dotCls = cx(
                "num relative z-10 inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border text-sm font-bold",
                done && "fill-accent border-transparent",
                active && "fill-accent border-transparent ring-4 ring-accent/25",
                !done && !active && "border-white/15 bg-night text-muted",
              );
              const inner = (
                <>
                  {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                  {done ? <span className="sr-only">Step {i + 1}, done.</span> : null}
                </>
              );
              return done && onStepClick ? (
                <button type="button" onClick={() => onStepClick(i)} className={cx(dotCls, "cursor-pointer")} aria-label={`Back to step ${i + 1}: ${s.label}`}>
                  {inner}
                </button>
              ) : (
                <span className={dotCls}>{inner}</span>
              );
            })()}
            <span className={cx("mt-2 px-1 text-[13px] font-semibold leading-tight", active || done ? "text-ink" : "text-muted")}>{s.label}</span>
            {s.hint ? <span className="mt-0.5 hidden px-1 text-[12.5px] text-muted sm:block">{s.hint}</span> : null}
            {s.tag ? (
              <span
                className={cx(
                  "mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-semibold",
                  s.tag.tone === "bad" ? "border-bad/45 bg-bad/[0.14] text-bad-fg" : "border-warn/45 bg-warn/10 text-warn",
                )}
              >
                {s.tag.tone === "warn" ? <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> : null}
                {s.tag.text}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Accessible modal on the native <dialog>: showModal() makes the rest of the page inert, so focus
 * stays inside; Esc and a click on the backdrop close it; focus returns to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null;
      d.showModal();
      d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        opener.current?.focus?.();
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx("gh-dialog m-auto max-w-none", size === "lg" ? "w-[min(94vw,760px)]" : "w-[min(92vw,460px)]", " overflow-visible bg-transparent p-0 text-ink backdrop:bg-frost/75 backdrop:backdrop-blur-sm")}
    >
      <div className="pane pane-highlight pane-glow rounded-[24px] p-6 hover:border-accent-light/30">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="title text-xl">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-full border border-white/10 bg-white/[0.05] p-1.5 text-muted hover:text-ink">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Data failed to load: what happened and what to do. Queries retry on their own every few seconds. */
export function LoadError({ error, what }: { error: string | null; what: string }) {
  if (!error) return null;
  return (
    <Note tone="bad">
      Couldn&apos;t load {what}: {error} It retries every few seconds; if this keeps happening, reload the page.
    </Note>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-[12px] bg-white/[0.06]", className)} aria-hidden />;
}

export function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 py-1.5", strong && "font-bold")}>
      <span className={strong ? "" : "text-muted"}>{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}

export function TxNote({ signature, mock, message }: { signature: string; mock: boolean; message?: string }) {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  return (
    <div className="text-sm text-muted">
      {message ? <span className="text-ink">{message} </span> : null}
      {mock ? (
        <span>Mock transaction, no Explorer page.</span>
      ) : (
        <a
          className="inline-flex items-center gap-1 font-semibold text-steel underline underline-offset-2 hover:text-ink"
          href={`https://explorer.solana.com/tx/${signature}?cluster=${cluster}`}
          target="_blank"
          rel="noreferrer"
        >
          View on Solana Explorer
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-bad-fg">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  ) : null;
}
