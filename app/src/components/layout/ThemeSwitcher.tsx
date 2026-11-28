"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTheme, type ThemePref } from "@/components/providers/ThemeProvider";
import { cx } from "../ui";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

/** Small icon button with a Dark / Light / System menu. Arrow keys move, Enter picks, Esc closes. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const btn = useRef<HTMLButtonElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const Current = OPTIONS.find((o) => o.value === pref)?.icon ?? Moon;

  useEffect(() => {
    if (!open) return;
    items.current[OPTIONS.findIndex((o) => o.value === pref)]?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.parentElement?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, pref]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const i = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") {
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = (i + (e.key === "ArrowDown" ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
      items.current[n]?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div className={cx("relative", className)}>
      <button
        ref={btn}
        type="button"
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line bg-haze/[0.04] text-muted transition-colors hover:border-line-hover hover:text-ink"
      >
        <Current className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Theme" onKeyDown={onMenuKey} className="pane absolute right-0 top-12 z-50 w-40 rounded-[14px] p-1">
          {OPTIONS.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={pref === o.value}
              onClick={() => {
                setPref(o.value);
                setOpen(false);
                btn.current?.focus();
              }}
              className={cx("flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[14px] font-medium", pref === o.value ? "text-accent-ink" : "text-ink hover:bg-haze/[0.06]")}
            >
              <o.icon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{o.label}</span>
              {pref === o.value ? <Check className="h-4 w-4" aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The same three choices as a row of buttons, for the mobile menu. */
export function ThemeChoices() {
  const { pref, setPref } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-full border border-line bg-haze/[0.04] p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => setPref(o.value)}
          className={cx("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold", pref === o.value ? "fill-accent" : "text-muted hover:text-ink")}
        >
          <o.icon className="h-4 w-4" aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  );
}
