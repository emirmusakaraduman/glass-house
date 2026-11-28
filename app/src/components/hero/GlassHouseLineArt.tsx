"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cx } from "../ui";

// GlassHouseLineArt (the fallback when the hero photo fails to load; see GlassHouseHero).
// "Glass house assembles": an original line drawing that builds itself once on load (~5.5s):
// ground → trees → house outlines → glass panels and a glint → a dashed capsule where money moves
// into escrow and the title is confirmed → lights → the car parks → reflection and a soft pulse.
//
// How it animates (CSS only, see "hero animation" in globals.css):
// - Every element's resting style IS the final frame; animations only run from a hidden "from"
//   state with fill-mode both. With prefers-reduced-motion the global rule turns animations off,
//   so the final frame shows at once and nothing idles.
// - Only transform, opacity and stroke-dashoffset are animated. No JS animation loop.
// - JS only remounts the SVG for Replay and pauses the idle glint/flicker when the drawing is
//   off-screen or the tab is hidden (data-paused).

// Fixed colors on purpose: the hero art always sits in a dark "night window" (data-theme="dark"),
// in both themes, so it keeps the dark palette.
const CYAN = "#00d2ff";
const TREE = "#5eead4";
const GOLD = "#f59e0b";

/** Delay and duration for one animated element, as CSS variables. */
const t = (d: number, dur?: number) => ({ "--d": `${d}s`, ...(dur ? { "--t": `${dur}s` } : {}) }) as CSSProperties;

function Scene() {
  const panels = [
    { x: 152, y: 264, w: 96, h: 86 },
    { x: 252, y: 264, w: 86, h: 86 },
    { x: 342, y: 264, w: 82, h: 86 },
    { x: 178, y: 174, w: 120, h: 56 },
    { x: 302, y: 174, w: 142, h: 56 },
  ];
  return (
    <>
      <defs>
        <linearGradient id="gha-light" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fbbf24" stopOpacity="0.85" />
          <stop offset="1" stopColor={GOLD} stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="gha-beam" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gha-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="gha-pulse" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={CYAN} stopOpacity="0.35" />
          <stop offset="1" stopColor={CYAN} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="gha-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="gha-reflect-mask" maskUnits="userSpaceOnUse" x="0" y="360" width="640" height="80">
          <rect x="0" y="360" width="640" height="80" fill="url(#gha-fade)" />
        </mask>
        <clipPath id="gha-glass">
          {panels.map((p, i) => (
            <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} />
          ))}
        </clipPath>
        <filter id="gha-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        {/* The capsule's dashes stay dashed; a solid stroke in a mask "draws" them in. */}
        <mask id="gha-capsule-mask" maskUnits="userSpaceOnUse">
          <rect className="gha-draw" style={t(2.4, 0.45)} pathLength={1} x="196" y="58" width="248" height="56" rx="28" fill="none" stroke="#fff" strokeWidth="6" />
        </mask>
      </defs>

      {/* ---------------------------------------------------------- ground and pulse */}
      <ellipse className="gha-pulse" style={t(4.6, 0.9)} cx="300" cy="362" rx="230" ry="18" fill="url(#gha-pulse)" />
      <path className="gha-draw" style={t(0, 0.6)} pathLength={1} d="M20 360 H620" stroke="rgb(255 255 255 / 0.2)" strokeWidth="2" />
      <path className="gha-draw" style={t(0.35, 0.5)} pathLength={1} d="M440 374 H612" stroke="rgb(255 255 255 / 0.2)" strokeWidth="1.5" />

      {/* ---------------------------------------------------------- reflection (built from the house) */}
      <g className="gha-fade gha-reflection" style={t(4.6, 0.9)} mask="url(#gha-reflect-mask)">
        <use href="#gha-house" transform="translate(0 720) scale(1 -1)" />
      </g>

      {/* ---------------------------------------------------------- trees */}
      <g stroke={TREE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path className="gha-draw" style={t(0.4, 0.35)} pathLength={1} d="M72 360 V300" />
        <path className="gha-draw" style={t(0.6, 0.25)} pathLength={1} d="M72 326 l-11 -10 M72 314 l10 -9" strokeWidth="1.5" />
        <circle className="gha-grow" style={t(0.6)} cx="72" cy="282" r="30" fill={TREE} fillOpacity="0.12" />
        <path className="gha-draw" style={t(0.5, 0.3)} pathLength={1} d="M112 360 V320" />
        <circle className="gha-grow" style={t(0.72)} cx="112" cy="308" r="17" fill={TREE} fillOpacity="0.12" />
        <path className="gha-grow" style={t(0.82)} d="M26 360 a18 18 0 0 1 36 0" fill={TREE} fillOpacity="0.1" />
        <path className="gha-draw" style={t(0.55, 0.35)} pathLength={1} d="M600 360 V302" />
        <circle className="gha-grow" style={t(0.78)} cx="600" cy="288" r="24" fill={TREE} fillOpacity="0.12" />
        <path className="gha-grow" style={t(0.95)} d="M568 360 a15 15 0 0 1 30 0" fill={TREE} fillOpacity="0.1" />
      </g>

      {/* ---------------------------------------------------------- house */}
      <g id="gha-house">
        {/* glass panels, one by one */}
        {panels.map((p, i) => (
          <g key={i} className="gha-fade" style={t(1.75 + i * 0.06, 0.35)}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={CYAN} fillOpacity={i < 3 ? 0.1 : 0.13} />
            <path d={`M${p.x + 10} ${p.y + p.h - 12} l${Math.min(26, p.w / 3)} ${-Math.min(26, p.w / 3)} M${p.x + 22} ${p.y + p.h - 10} l${Math.min(14, p.w / 6)} ${-Math.min(14, p.w / 6)}`} stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" />
          </g>
        ))}

        {/* interior lights: ground floor first, then upstairs */}
        <g className="gha-idle gha-flicker">
          <g className="gha-fade" style={t(3.2, 0.35)} filter="url(#gha-glow)" opacity="0.75">
            <rect x="158" y="300" width="84" height="46" fill="url(#gha-light)" />
            <rect x="258" y="300" width="74" height="46" fill="url(#gha-light)" />
            <rect x="392" y="300" width="28" height="46" fill="url(#gha-light)" />
          </g>
          <g className="gha-fade" style={t(3.5, 0.4)} filter="url(#gha-glow)" opacity="0.7">
            <rect x="184" y="196" width="108" height="32" fill="url(#gha-light)" />
            <rect x="308" y="196" width="130" height="32" fill="url(#gha-light)" />
          </g>
          <g fill="#fbbf24">
            <circle className="gha-pop" style={t(3.25)} cx="200" cy="276" r="3.5" />
            <circle className="gha-pop" style={t(3.3)} cx="296" cy="276" r="3.5" />
            <circle className="gha-pop" style={t(3.55)} cx="240" cy="186" r="3" />
            <circle className="gha-pop" style={t(3.6)} cx="372" cy="186" r="3" />
          </g>
        </g>

        {/* outlines: slabs, columns, roof, railing, door */}
        <g stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <rect className="gha-draw" style={t(0.9, 0.35)} pathLength={1} x="138" y="352" width="300" height="8" />
          {[150, 250, 340, 426].map((x, i) => (
            <path key={x} className="gha-draw" style={t(1.05 + i * 0.05, 0.3)} pathLength={1} d={`M${x} 352 V262`} />
          ))}
          <rect className="gha-draw" style={t(1.25, 0.4)} pathLength={1} x="126" y="254" width="332" height="8" />
          {[176, 300, 446].map((x, i) => (
            <path key={x} className="gha-draw" style={t(1.45 + i * 0.05, 0.3)} pathLength={1} d={`M${x} 254 V172`} />
          ))}
          <path className="gha-draw" style={t(1.62, 0.45)} pathLength={1} d="M146 172 H476 L486 160 H156 Z" />
          <path className="gha-draw" style={t(1.85, 0.35)} pathLength={1} d="M176 232 H446" />
          <path className="gha-draw" style={t(1.95, 0.25)} pathLength={1} d="M238 232 V254 M300 232 V254 M372 232 V254" strokeWidth="1.5" strokeOpacity="0.7" />
          <rect className="gha-draw" style={t(2.05, 0.3)} pathLength={1} x="354" y="286" width="32" height="66" strokeWidth="1.5" />
          <path className="gha-draw" style={t(2.2, 0.15)} pathLength={1} d="M380 318 v8" strokeWidth="1.5" />
        </g>
        <rect className="gha-fade" style={t(2.1, 0.3)} x="176" y="232" width="270" height="22" fill={CYAN} fillOpacity="0.07" />

        {/* one glint across the glass after the panels, then an idle glint every ~8s */}
        <g clipPath="url(#gha-glass)">
          <rect className="gha-sweep" style={t(2.15, 0.6)} x="70" y="160" width="46" height="200" fill="url(#gha-sweep)" />
          <rect className="gha-idle gha-glint" x="70" y="160" width="46" height="200" fill="url(#gha-sweep)" />
        </g>
      </g>

      {/* ---------------------------------------------------------- capsule: USDC → escrow → title */}
      <g>
        <path className="gha-draw" style={t(2.45, 0.3)} pathLength={1} d="M320 114 V158" stroke={CYAN} strokeOpacity="0.4" strokeWidth="1.5" />
        <rect mask="url(#gha-capsule-mask)" x="196" y="58" width="248" height="56" rx="28" fill={CYAN} fillOpacity="0.05" stroke={CYAN} strokeWidth="2" strokeDasharray="7 7" />
        <g stroke="rgb(255 255 255 / 0.3)" strokeWidth="1.5" strokeDasharray="3 4">
          <path className="gha-fade" style={t(2.85, 0.2)} d="M270 86 H302" />
          <path className="gha-fade" style={t(3.15, 0.2)} d="M338 86 H370" />
        </g>
        {/* USDC coin */}
        <g className="gha-pop" style={t(2.7)}>
          <circle cx="252" cy="86" r="17" fill="#131c31" stroke={CYAN} strokeWidth="2" />
          <text x="252" y="92" textAnchor="middle" fontSize="17" fontWeight="800" fill={CYAN} fontFamily="var(--font-jakarta), sans-serif">
            $
          </text>
        </g>
        {/* escrow lock */}
        <g className="gha-pop" style={t(3.0)}>
          <circle cx="320" cy="86" r="17" fill="#131c31" stroke={CYAN} strokeWidth="2" />
          <path d="M314 85 v-4 a6 6 0 0 1 12 0 v4" fill="none" stroke={CYAN} strokeWidth="1.8" strokeLinecap="round" />
          <rect x="311" y="85" width="18" height="12" rx="3" fill={CYAN} fillOpacity="0.2" stroke={CYAN} strokeWidth="1.8" />
        </g>
        {/* title confirmed */}
        <g className="gha-pop" style={t(3.35)}>
          <circle cx="388" cy="86" r="17" fill="#131c31" stroke="#34d399" strokeWidth="2" />
          <path d="M380 86 l5 5 l10 -11" fill="none" stroke="#34d399" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* a light dot carries the money along the capsule */}
        <circle className="gha-dot" cx="270" cy="86" r="4" fill="#e0f7ff" />
      </g>

      {/* ---------------------------------------------------------- car (parks at the entrance) */}
      <g className="gha-car">
        <path className="gha-fade" style={t(4.45, 0.35)} d="M424 331 L372 318 L372 348 Z" fill="url(#gha-beam)" />
        <path
          d="M424 346 V334 Q424 327 432 326 L456 324 L478 306 Q482 303 488 303 L520 303 Q527 303 531 308 L546 323 L562 325 Q570 326 570 334 V346 H555 A15 15 0 0 0 525 346 H467 A15 15 0 0 0 437 346 Z"
          fill="#131c31"
          stroke={CYAN}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M462 323 L480 309 L505 309 L505 323 Z M510 309 L527 309 L540 323 L510 323 Z" fill={CYAN} fillOpacity="0.12" stroke={CYAN} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M508 326 V343 M496 331 h7" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" />
        <rect className="gha-fade" style={t(4.4, 0.3)} x="424" y="329" width="7" height="5" rx="2" fill="#fbbf24" />
        <rect x="564" y="330" width="6" height="5" rx="2" fill="#f43f5e" fillOpacity="0.8" />
        {[452, 540].map((cx) => (
          <g key={cx} className="gha-wheel">
            <circle cx={cx} cy="347" r="13" fill="#0b1120" stroke={CYAN} strokeWidth="2" />
            <circle cx={cx} cy="347" r="4.5" fill="none" stroke={CYAN} strokeWidth="1.5" />
            <path d={`M${cx} 342.5 V336 M${cx + 3.9} 349.3 l5.6 3.2 M${cx - 3.9} 349.3 l-5.6 3.2`} stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" />
          </g>
        ))}
      </g>
    </>
  );
}

export function GlassHouseLineArt({ className }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);

  // Idle animations stop when the drawing is off-screen or the tab is hidden.
  useEffect(() => {
    const el = wrap.current;
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

  return (
    <div ref={wrap} className={cx("gha relative aspect-[640/440] w-full", className)} data-paused={paused ? "true" : "false"}>
      <svg
        key={run}
        viewBox="0 0 640 440"
        className="h-full w-full"
        role="img"
        aria-label="A glass house and a car drawn line by line: money moves into escrow, the title is confirmed, and the lights come on."
      >
        <Scene />
      </svg>
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        aria-label="Replay animation"
        title="Replay animation"
        className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-[rgb(19_28_49/0.7)] text-accent-ink backdrop-blur hover:border-accent/60 hover:bg-accent/10 motion-reduce:hidden"
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
