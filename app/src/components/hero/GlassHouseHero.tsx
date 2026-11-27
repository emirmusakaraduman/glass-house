"use client";

import { RotateCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import heroImage from "../../../public/hero/glasshouse-hero.png";
import { cx } from "../ui";
import { GlassHouseLineArt } from "./GlassHouseLineArt";
import * as G from "./heroGeometry";

// "Blueprint to real home" (~6s, once on load):
// dot grid → ground → house and car lines (on top of the photo's own edges) → glass panels and a
// light sweep → the photo opens from the front door with the lights coming on → the car slides
// into its outline → lines settle into a thin neon edge → USDC → escrow → title capsule → chips.
//
// Layers, stacked in one 868:561 box (the photo's own size, so every SVG uses the photo's pixels):
//   L0 ambient glow · L1 photo (vignette mask, door reveal, window glows, purple-light neutralizer,
//   a dark patch where the car will park) · L1b car (same photo clipped to the car) · L2 glass
//   fills · L3 lines · L4 capsule · L5 chips (children) and Replay.
//
// Animation is CSS only (see "hero (GlassHouseHero)" in globals.css). Every element's resting style
// is the final frame and animations run from a hidden "from" state (fill-mode both), so reduced
// motion (all animations off) shows the final frame at once. JS only: Replay (remount), pausing the
// idle loops off-screen or in a hidden tab, mouse parallax on desktop, and the photo-error fallback.

const LABEL =
  "A glass house and a car drawn line by line, then revealed as a real home: money moves into escrow, the title is confirmed, and the lights come on.";
const SIZES = "(min-width: 1024px) 720px, 100vw";

/** Delay and duration for one animated element, as CSS variables. */
const t = (d: number, dur?: number) => ({ "--d": `${d}s`, ...(dur ? { "--t": `${dur}s` } : {}) }) as CSSProperties;
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;

/** Draw order of the house outlines: ground slab → columns → upper slab → roof slab → glass shell. */
const MAIN_START = [0.7, 0.86, 1.08, 1.26, 1.42];

function Lines() {
  let detailAt = 1.78;
  return (
    <svg className="ghh-layer ghh-lines" viewBox={`0 0 ${G.PHOTO_W} ${G.PHOTO_H}`} aria-hidden focusable="false">
      <defs>
        <pattern id="ghh-dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="1.1" className="ghh-dot-fill" />
        </pattern>
        <filter id="ghh-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* blueprint dot grid, only while the drawing builds */}
      <rect className="ghh-grid" width={G.PHOTO_W} height={G.PHOTO_H} fill="url(#ghh-dots)" />

      {/* details: ground, trees, mullions and railings; they fade out when the lines settle */}
      <g className="ghh-detail">
        <g className="ghh-faint">
          {G.GROUND.map((s, i) => (
            <path key={s.note} className="ghh-draw" style={t(0.3 + i * 0.06, 0.6)} pathLength={1} d={s.d} />
          ))}
          {G.TREES.map((s, i) => (
            <path key={s.note} className="ghh-draw" style={t(0.75 + i * 0.12, 0.8)} pathLength={1} d={s.d} />
          ))}
        </g>
        {G.HOUSE_DETAIL.map((s) => {
          detailAt += 0.04;
          return <path key={s.note} className="ghh-draw" style={t(detailAt, 0.4)} pathLength={1} d={s.d} />;
        })}
      </g>

      {/* main outlines: stay on as the thin neon edge */}
      <g className="ghh-main" filter="url(#ghh-glow)">
        {G.HOUSE_MAIN.map((group, gi) =>
          group.map((s, i) => <path key={s.note} className="ghh-draw" style={t(MAIN_START[gi] + i * 0.06, 0.45)} pathLength={1} d={s.d} />),
        )}
        {G.CAR_LINES.map((s, i) => (
          <path key={s.note} className="ghh-draw" style={t(1.5 + i * 0.08, 0.6)} pathLength={1} d={s.d} />
        ))}
        {G.CAR_WHEELS.map((w, i) => (
          <ellipse key={w.note} className="ghh-draw" style={t(1.7 + i * 0.06, 0.4)} pathLength={1} cx={w.cx} cy={w.cy} rx={w.rx} ry={w.ry} />
        ))}
        {G.CAR_HEADLIGHTS.map((h, i) => (
          <ellipse key={h.note} className="ghh-draw" style={t(1.85 + i * 0.06, 0.3)} pathLength={1} cx={h.cx} cy={h.cy} rx={h.rx} ry={h.ry} />
        ))}
      </g>
    </svg>
  );
}

function Glass() {
  return (
    <svg className="ghh-layer ghh-glass" viewBox={`0 0 ${G.PHOTO_W} ${G.PHOTO_H}`} aria-hidden focusable="false">
      <defs>
        <clipPath id="ghh-glass-clip">
          {G.GLASS_PANELS.map((p) => (
            <polygon key={p} points={p} />
          ))}
        </clipPath>
        <linearGradient id="ghh-sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" className="ghh-stop-white0" />
          <stop offset="0.5" className="ghh-stop-white" />
          <stop offset="1" className="ghh-stop-white0" />
        </linearGradient>
      </defs>
      <g className="ghh-panels">
        {G.GLASS_PANELS.map((p, i) => {
          const pts = p.split(" ").map((q) => q.split(",").map(Number));
          const minX = Math.min(...pts.map((q) => q[0]));
          const maxY = Math.max(...pts.map((q) => q[1]));
          return (
            <g key={p} className="ghh-fade" style={t(1.6 + i * 0.07, 0.35)}>
              <polygon points={p} className="ghh-pane" />
              {/* two thin diagonal glints in the lower-left corner of each pane */}
              <path className="ghh-glint-line" d={`M${minX + 8} ${maxY - 10} l22 -22 M${minX + 18} ${maxY - 8} l12 -12`} />
            </g>
          );
        })}
      </g>
      <g clipPath="url(#ghh-glass-clip)">
        <rect className="ghh-sweep" x="60" y="40" width="70" height="380" fill="url(#ghh-sweep-grad)" />
        <rect className="ghh-idle ghh-sweep-idle" x="60" y="40" width="40" height="380" fill="url(#ghh-sweep-grad)" />
      </g>
    </svg>
  );
}

function Capsule() {
  // In the empty sky above the apex (465,64); it may rise a little above the photo box.
  const cx = 465;
  const y = -6;
  const icons = [cx - 70, cx, cx + 70];
  return (
    <svg className="ghh-layer ghh-capsule" viewBox={`0 0 ${G.PHOTO_W} ${G.PHOTO_H}`} aria-hidden focusable="false">
      <defs>
        {/* The capsule's dashes stay dashed; a solid stroke in a mask "draws" them in. */}
        <mask id="ghh-capsule-mask" maskUnits="userSpaceOnUse" x="300" y="-60" width="330" height="120">
          <rect className="ghh-draw ghh-mask-stroke" style={t(3.6, 0.45)} pathLength={1} x={cx - 118} y={y - 25} width="236" height="50" rx="25" />
        </mask>
      </defs>
      <g className="ghh-capsule-g">
        <path className="ghh-draw ghh-connector" style={t(4.3, 0.3)} pathLength={1} d={`M${cx} ${y + 25} V62`} />
        <rect mask="url(#ghh-capsule-mask)" className="ghh-capsule-shape" x={cx - 118} y={y - 25} width="236" height="50" rx="25" />
        <path className="ghh-fade ghh-link" style={t(4.0, 0.2)} d={`M${icons[0] + 20} ${y} H${icons[1] - 20}`} />
        <path className="ghh-fade ghh-link" style={t(4.25, 0.2)} d={`M${icons[1] + 20} ${y} H${icons[2] - 20}`} />
        {/* USDC coin */}
        <g className="ghh-pop" style={t(3.85)}>
          <circle cx={icons[0]} cy={y} r="15" className="ghh-chip-circle" />
          <text x={icons[0]} y={y + 5.5} textAnchor="middle" className="ghh-dollar">
            $
          </text>
        </g>
        {/* escrow lock */}
        <g className="ghh-pop" style={t(4.1)}>
          <circle cx={icons[1]} cy={y} r="15" className="ghh-chip-circle" />
          <path d={`M${cx - 5} ${y - 1} v-4 a5 5 0 0 1 10 0 v4`} className="ghh-icon-stroke" />
          <rect x={cx - 8} y={y - 1} width="16" height="10" rx="2.5" className="ghh-icon-stroke ghh-lock-body" />
        </g>
        {/* title confirmed */}
        <g className="ghh-pop" style={t(4.35)}>
          <circle cx={icons[2]} cy={y} r="15" className="ghh-chip-circle ghh-ok" />
          <path d={`M${icons[2] - 7} ${y} l4.5 4.5 l9 -9.5`} className="ghh-check" />
        </g>
        {/* a light dot carries the money along the capsule */}
        <circle className="ghh-money" cx={icons[0] + 18} cy={y} r="3.5" />
      </g>
    </svg>
  );
}

function Stage({ onError }: { onError: () => void }) {
  const flare = (x: number, y: number) => ({ left: pct(x, G.PHOTO_W), top: pct(y, G.PHOTO_H) });
  return (
    <div className="ghh-stage" role="img" aria-label={LABEL}>
      {/* L0: soft cyan and a hint of gold under the house, a light ellipse on the ground */}
      <div className="ghh-layer ghh-ambient" data-depth="glow" aria-hidden />

      <div className="ghh-layer" data-depth="photo" aria-hidden>
        {/* L1: the photo, dissolving into the page at every edge */}
        <div className="ghh-layer ghh-vignette ghh-photo" style={{ ["--door-x" as string]: pct(G.DOOR.x, G.PHOTO_W), ["--door-y" as string]: pct(G.DOOR.y, G.PHOTO_H) }}>
          <Image src={heroImage} alt="" fill preload sizes={SIZES} className="ghh-img" draggable={false} onError={onError} />
          {/* the photo's purple ground lights, pulled toward cyan (color blend, ground band only) */}
          <svg className="ghh-layer ghh-blend-color" viewBox={`0 0 ${G.PHOTO_W} ${G.PHOTO_H}`} focusable="false">
            <defs>
              <filter id="ghh-soft-line" x="-5%" y="-20%" width="110%" height="140%">
                <feGaussianBlur stdDeviation="2" />
              </filter>
            </defs>
            <g className="ghh-neutralize" filter="url(#ghh-soft-line)">
              {G.GROUND.slice(2, 5).map((s) => (
                <path key={s.note} d={s.d} />
              ))}
            </g>
          </svg>
          {/* window light, ground floor first, then upstairs; breathes while idle (screen blend) */}
          <svg className="ghh-layer ghh-blend-screen" viewBox={`0 0 ${G.PHOTO_W} ${G.PHOTO_H}`} focusable="false">
            <defs>
              <radialGradient id="ghh-warm" cx="0.5" cy="0.25" r="0.7">
                <stop offset="0" className="ghh-stop-gold" />
                <stop offset="1" className="ghh-stop-gold0" />
              </radialGradient>
              <filter id="ghh-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            <g className="ghh-idle ghh-breathe">
              {(["ground", "upper"] as const).map((floor, fi) => (
                <g key={floor} className="ghh-fade ghh-windows" style={t(2.5 + fi * 0.3, 0.5)} filter="url(#ghh-soft)">
                  {G.WINDOW_GLOWS[floor].map((r) => (
                    <rect key={r.x} x={r.x} y={r.y} width={r.w} height={r.h} fill="url(#ghh-warm)" />
                  ))}
                </g>
              ))}
            </g>
          </svg>
          {/* dark, soft patch over the photo's car until the car layer has parked */}
          <div className="ghh-layer ghh-patch">
            <div className="ghh-layer ghh-patch-shape" style={{ clipPath: G.carClipPath }} />
          </div>
        </div>

        {/* L1b: the same photo, clipped to the car, slides in from the right */}
        <div className="ghh-layer ghh-vignette">
          <div className="ghh-layer ghh-car">
            <div className="ghh-layer" style={{ clipPath: G.carClipPath }}>
              <Image src={heroImage} alt="" fill sizes={SIZES} className="ghh-img" draggable={false} />
            </div>
            {G.FLARES.map((f) => (
              <span key={f.x} className="ghh-flare" style={flare(f.x, f.y)} />
            ))}
          </div>
        </div>

        {/* L2: glass */}
        <Glass />
      </div>

      {/* L3: lines */}
      <div className="ghh-layer" data-depth="lines" aria-hidden>
        <Lines />
      </div>

      {/* L4: USDC → escrow → title */}
      <div className="ghh-layer ghh-capsule-wrap" data-depth="capsule" aria-hidden>
        <Capsule />
      </div>
    </div>
  );
}

/**
 * The landing-page hero visual. `children` (the chips) sit on the top layer: floating around the
 * picture from lg up, in a row under it below lg.
 */
export function GlassHouseHero({ className, children }: { className?: string; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);

  // Idle loops wait while the hero is off-screen or the tab is hidden.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let visible = true;
    const update = () => setPaused(!visible || document.visibilityState === "hidden");
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // Mouse parallax: desktop with a fine pointer only, never with reduced motion. rAF-throttled.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const mq = window.matchMedia("(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    let frame = 0;
    let last: PointerEvent | null = null;
    const apply = () => {
      frame = 0;
      if (!last || !mq.matches) return;
      const r = el.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (last.clientX - (r.left + r.width / 2)) / (r.width / 2 + 200)));
      const y = Math.max(-1, Math.min(1, (last.clientY - (r.top + r.height / 2)) / (r.height / 2 + 200)));
      el.style.setProperty("--ghh-mx", x.toFixed(3));
      el.style.setProperty("--ghh-my", y.toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onMq = () => {
      if (!mq.matches) {
        el.style.removeProperty("--ghh-mx");
        el.style.removeProperty("--ghh-my");
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("pointermove", onMove);
      mq.removeEventListener("change", onMq);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={root} className={cx("ghh relative mx-auto w-full max-w-[720px]", className)} data-paused={paused ? "true" : "false"}>
      {failed ? (
        <>
          <GlassHouseLineArt className="relative" />
          {children}
        </>
      ) : (
        <div key={run} className="ghh-run">
          <div className="relative">
            <Stage onError={() => setFailed(true)} />
            <button
              type="button"
              onClick={() => setRun((n) => n + 1)}
              aria-label="Replay animation"
              title="Replay animation"
              className="absolute bottom-1 right-1 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-[rgb(19_28_49/0.7)] text-accent backdrop-blur hover:border-accent/60 hover:bg-accent/10 motion-reduce:hidden"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <div className="ghh-chips" data-depth="chips">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
