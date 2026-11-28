"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

// Collapse effects for one /stress panel: a breathing edge glow (stress), glass cracks, flames,
// sparks and smoke (collapse). Everything here is decoration: aria-hidden, pointer-events none,
// behind the panel's text. The flames are a Canvas 2D particle system with its own rAF loop that
// only runs while the panel is burning, on screen and in a visible tab.
//
// Light safety: nothing flashes faster than 3 times a second. The only pulses are the 2 s glow
// and one shake when the collapse happens.

export type FxLevel = 0 | 1 | 2;

export interface CollapseFxHandle {
  /**
   * New level. `moment` = the collapse just happened during playback (play the one-off shake and
   * draw the cracks); otherwise the state is shown without the moment. `origin` is where the cracks
   * start, in viewport pixels.
   */
  setLevel: (level: FxLevel, opts: { moment: boolean; origin: { x: number; y: number } | null }) => void;
}

const MAX_PARTICLES = 180;
const SPARK_SHARE = 0.2;
const STRONG_MS = 3000;
const FADE_MS = 600;

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  spark: boolean;
}

/** One soft round sprite per color; drawn scaled with additive blending. */
function sprite(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.4, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** 6–8 jagged lines out of the origin (a fixed seed per panel, so the glass breaks the same way). */
function crackPaths(w: number, h: number, ox: number, oy: number, seed: number, minY: number) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = 6 + Math.floor(rnd() * 3);
  const out: { d: string; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    let ang = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
    // Short cracks around the point of failure, not across the whole panel.
    const reach = (0.12 + rnd() * 0.16) * Math.max(w, h);
    let x = ox;
    let y = oy;
    let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    let len = 0;
    const steps = 5 + Math.floor(rnd() * 3);
    for (let k = 0; k < steps; k++) {
      ang += (rnd() - 0.5) * 0.7;
      const seg = (reach / steps) * (0.6 + rnd() * 0.8);
      const nx = Math.max(0, Math.min(w, x + Math.cos(ang) * seg));
      const ny = Math.max(minY, Math.min(h, y + Math.sin(ang) * seg));
      len += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
      d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    out.push({ d, len: Math.ceil(len) + 2 });
  }
  return out;
}

export function CollapseFx({ animate, seed, ref }: { animate: boolean; seed: number; ref?: Ref<CollapseFxHandle> }) {
  const root = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const cracks = useRef<SVGSVGElement | null>(null);
  const level = useRef<FxLevel>(0);
  const animateRef = useRef(animate);
  const parts = useRef<P[]>([]);
  const raf = useRef<number | null>(null);
  const visible = useRef(true);
  const burnStart = useRef(0);
  const intensity = useRef(0); // eased 0..1
  const fade = useRef(0); // 1 while burning, falls to 0 in FADE_MS after
  const last = useRef(0);
  const sprites = useRef<HTMLCanvasElement[] | null>(null);

  const stop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const frame = (now: number) => {
    raf.current = null;
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dt = Math.min(50, last.current ? now - last.current : 16);
    last.current = now;
    const t0 = performance.now();

    const burning = level.current === 2 && animateRef.current;
    // Strong for the first 3 s, then 60%. Ramps up in 250 ms; on the way out everything fades in FADE_MS.
    const target = burning ? (now - burnStart.current < STRONG_MS ? 1 : 0.6) : 0;
    if (target > intensity.current) intensity.current = Math.min(target, intensity.current + dt / 250);
    else intensity.current = Math.max(target, intensity.current - dt / 1500);
    fade.current = burning ? 1 : Math.max(0, fade.current - dt / FADE_MS);
    if (!burning && fade.current === 0) parts.current = [];

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.width / dpr;
    const h = cv.height / dpr;
    const ps = parts.current;

    // Spawn: flames along the bottom edge, a share of sparks.
    const want = burning ? Math.round(MAX_PARTICLES * intensity.current) : 0;
    let spawn = Math.min(want - ps.length, Math.ceil((dt / 16) * 12 * intensity.current));
    while (spawn-- > 0 && ps.length < MAX_PARTICLES) {
      const spark = Math.random() < SPARK_SHARE;
      ps.push({
        x: Math.random() * w,
        y: h + 6,
        vx: (Math.random() - 0.5) * (spark ? 0.05 : 0.025),
        vy: -(spark ? 0.07 + Math.random() * 0.09 : 0.05 + Math.random() * 0.06) * (0.7 + 0.5 * intensity.current),
        life: 0,
        max: spark ? 1800 + Math.random() * 2200 : 900 + Math.random() * 700,
        size: spark ? 1.4 + Math.random() * 1.4 : (22 + Math.random() * 30) * (0.75 + 0.35 * intensity.current),
        spark,
      });
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    const [deep, orange, yellow] = sprites.current!;
    const flameTop = h * 0.65; // flames stay in the bottom 35%
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      p.x += p.vx * dt + (p.spark ? Math.sin((p.life + i * 97) / 220) * 0.15 : 0);
      p.y += p.vy * dt;
      const u = p.life / p.max;
      if (u >= 1 || (!p.spark && p.y < flameTop - 10)) {
        ps.splice(i, 1);
        continue;
      }
      if (p.spark) {
        ctx.globalAlpha = Math.max(0, (1 - u) * 0.9 * fade.current);
        ctx.fillStyle = u < 0.5 ? "#fde68a" : "#fb923c";
        ctx.fillRect(p.x, p.y, p.size, p.size);
        continue;
      }
      // Dark red at the base, orange through the middle, a yellow tip.
      const img = u < 0.35 ? deep : u < 0.75 ? orange : yellow;
      const s = p.size * (1 - u * 0.55);
      ctx.globalAlpha = Math.max(0, Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.8 * fade.current);
      ctx.drawImage(img, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const probe = (window as unknown as { __ghFxProbe?: { ms: number; frames: number } }).__ghFxProbe;
    if (probe) {
      probe.ms += performance.now() - t0;
      probe.frames++;
    }

    if ((burning || ps.length > 0) && visible.current) raf.current = requestAnimationFrame(frame);
    else if (!burning && ps.length === 0) ctx.clearRect(0, 0, w, h);
  };

  const kick = () => {
    if (raf.current === null && visible.current) {
      last.current = 0;
      raf.current = requestAnimationFrame(frame);
    }
  };

  useEffect(() => {
    animateRef.current = animate;
    if (!animate) {
      parts.current = [];
      intensity.current = 0;
    }
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  // Canvas size follows the panel; DPR capped at 2.
  useEffect(() => {
    sprites.current = [sprite("rgba(190,30,30,0.9)", "rgba(120,10,20,0.45)"), sprite("rgba(255,140,40,0.95)", "rgba(220,60,20,0.45)"), sprite("rgba(255,230,120,0.95)", "rgba(255,150,40,0.4)")];
    const el = root.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = el.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    // Stop when off screen or the tab is hidden.
    let onScreen = true;
    const update = () => {
      visible.current = onScreen && document.visibilityState === "visible";
      if (visible.current) kick();
      else stop();
    };
    const io = new IntersectionObserver((e) => {
      onScreen = e.some((x) => x.isIntersecting);
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setLevel(next, { moment, origin }) {
      const prev = level.current;
      level.current = next;
      const el = root.current;
      if (!el) return;
      el.dataset.level = String(next);
      if (next === 2 && prev !== 2) {
        burnStart.current = performance.now();
        // Cracks from the collapse point outward.
        const svg = cracks.current;
        const r = el.getBoundingClientRect();
        if (svg && r.width > 0) {
          const ox = origin ? origin.x - r.left : r.width * 0.75;
          const oy = origin ? origin.y - r.top : r.height * 0.6;
          svg.setAttribute("viewBox", `0 0 ${r.width.toFixed(0)} ${r.height.toFixed(0)}`);
          // Keep the cracks below the header so the verdict line stays clean.
          svg.innerHTML = crackPaths(r.width, r.height, ox, Math.max(oy, 84), seed, 84)
            .map((c) => `<path d="${c.d}" style="--len:${c.len}" stroke-dasharray="${c.len}" />`)
            .join("");
          el.dataset.crack = moment && animateRef.current ? "draw" : "static";
          // Restart the draw-in.
          void svg.getBoundingClientRect();
          el.dataset.cracked = "1";
        }
      }
      if (next < 2) el.dataset.cracked = "0";
      kick();
    },
  }));

  return (
    <div ref={root} className="gh-fx pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" data-level="0" data-cracked="0" aria-hidden>
      <div className="gh-fx-glow absolute inset-0 rounded-[inherit]" />
      <div className="gh-fx-smoke absolute inset-x-0 top-0 h-1/2" />
      <canvas ref={canvas} className="gh-fx-canvas absolute inset-0 h-full w-full" />
      <svg ref={cracks} className="gh-fx-cracks absolute inset-0 h-full w-full" preserveAspectRatio="none" />
    </div>
  );
}
