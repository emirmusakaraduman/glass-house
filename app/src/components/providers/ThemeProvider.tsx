"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Theme: dark (default), light or system. <html data-theme> is set before the first paint by
// THEME_SCRIPT (app/layout.tsx); this provider keeps it in sync after that.

export type ThemePref = "dark" | "light" | "system";
export type Theme = "dark" | "light";

export const THEME_KEY = "glasshouse:theme";

/**
 * Runs in <head> before React: picks the theme from storage (or the OS for "system") so the wrong
 * theme never flashes. ?present=1 on /stress is always dark. Kept small and dependency-free.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement,t="dark";try{var p=localStorage.getItem("${THEME_KEY}");if(p==="light"||p==="dark")t=p;else if(p==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(location.pathname.indexOf("/stress")===0&&/[?&]present=1/.test(location.search))t="dark";}catch(e){}d.setAttribute("data-theme",t);})();`;

function readPref(): ThemePref {
  try {
    const p = window.localStorage.getItem(THEME_KEY);
    return p === "light" || p === "system" ? p : "dark";
  } catch {
    return "dark";
  }
}

const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

/** Sets <html data-theme>, easing colors for 150 ms (CSS skips it with reduced motion). */
function apply(theme: Theme, animate: boolean) {
  const html = document.documentElement;
  if (html.getAttribute("data-theme") === theme) return;
  if (animate) {
    html.classList.add("theme-switching");
    window.setTimeout(() => html.classList.remove("theme-switching"), 200);
  }
  html.setAttribute("data-theme", theme);
}

interface ThemeCtx {
  pref: ThemePref;
  theme: Theme;
  setPref: (p: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx>({ pref: "dark", theme: "dark", setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("dark");
  const [theme, setTheme] = useState<Theme>("dark");

  // Pick up what the head script decided.
  useEffect(() => {
    setPrefState(readPref());
    setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  }, []);

  // "system": follow the OS while it is selected.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => {
      const t = systemTheme();
      apply(t, true);
      setTheme(t);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      window.localStorage.setItem(THEME_KEY, p);
    } catch {
      /* storage blocked: the choice still applies to this visit */
    }
    const t = p === "system" ? systemTheme() : p;
    apply(t, true);
    setPrefState(p);
    setTheme(t);
  }, []);

  return <Ctx.Provider value={{ pref, theme, setPref }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
