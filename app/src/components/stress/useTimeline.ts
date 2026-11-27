"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TIMELINE_MONTHS } from "@/lib/stressTimeline";

// Clock for the crash animation. `t` (months, 0–15) lives in a ref and advances on
// requestAnimationFrame; subscribers draw straight to the DOM every frame. React state only
// changes when the whole month, play state or end state changes.

export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

/** Seconds for the full 15 months at 1×. */
const DURATION_S = 12;

export interface Tick {
  t: number;
  /** Milliseconds since the previous frame (0 on a jump). */
  dt: number;
  /** True when the clock moved because it is playing (not a seek or a wake-up). */
  advancing: boolean;
  /** Reduced motion: draw the target state directly, no easing, no particles. */
  instant: boolean;
}

/** Return true to ask for another frame (still easing toward a target). */
export type Subscriber = (tick: Tick) => boolean | void;

export function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

export interface TimelineEngine {
  month: number;
  playing: boolean;
  ended: boolean;
  speed: Speed;
  reducedMotion: boolean;
  setSpeed: (s: Speed) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  replay: () => void;
  seek: (month: number) => void;
  getT: () => number;
  subscribe: (fn: Subscriber) => () => void;
  /** Draw again without moving the clock (after the scenario changed). */
  wake: () => void;
}

export function useTimeline(containerRef: RefObject<HTMLElement | null>): TimelineEngine {
  const reducedMotion = useReducedMotion();
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const speedRef = useRef<Speed>(1);
  const visibleRef = useRef(true);
  const subs = useRef(new Set<Subscriber>());
  const raf = useRef<number | null>(null);
  const last = useRef<number | null>(null);
  const jumped = useRef(true);

  const [month, setMonth] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeedState] = useState<Speed>(1);

  const syncState = useCallback(() => {
    const t = tRef.current;
    setMonth(Math.min(TIMELINE_MONTHS, Math.floor(t + 1e-9)));
    setEnded(t >= TIMELINE_MONTHS);
    setPlaying(playingRef.current);
  }, []);

  const loop = useCallback(
    (now: number) => {
      raf.current = null;
      const dt = last.current === null || jumped.current ? 0 : Math.min(100, now - last.current);
      last.current = now;
      const wasJump = jumped.current;
      jumped.current = false;

      let advancing = false;
      if (playingRef.current && visibleRef.current && !wasJump) {
        const prevMonth = Math.floor(tRef.current);
        tRef.current = Math.min(TIMELINE_MONTHS, tRef.current + ((dt / 1000) * TIMELINE_MONTHS * speedRef.current) / DURATION_S);
        advancing = dt > 0;
        if (tRef.current >= TIMELINE_MONTHS) {
          playingRef.current = false;
          syncState();
        } else if (Math.floor(tRef.current) !== prevMonth) {
          syncState();
        }
      }

      let busy = false;
      const tick: Tick = { t: tRef.current, dt, advancing, instant: reducedMotion };
      subs.current.forEach((fn) => {
        if (fn(tick)) busy = true;
      });
      if ((playingRef.current && visibleRef.current) || busy || wasJump) {
        raf.current = requestAnimationFrame(loop);
      } else {
        last.current = null;
      }
    },
    [reducedMotion, syncState],
  );

  const kick = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(loop);
  }, [loop]);

  const wake = useCallback(() => {
    jumped.current = true;
    kick();
  }, [kick]);

  const seek = useCallback(
    (m: number) => {
      tRef.current = Math.max(0, Math.min(TIMELINE_MONTHS, m));
      if (tRef.current >= TIMELINE_MONTHS) playingRef.current = false;
      syncState();
      wake();
    },
    [syncState, wake],
  );

  const play = useCallback(() => {
    if (reducedMotion) {
      // No motion: the result is the point, so go straight to the last frame.
      playingRef.current = false;
      seek(TIMELINE_MONTHS);
      return;
    }
    if (tRef.current >= TIMELINE_MONTHS) tRef.current = 0;
    playingRef.current = true;
    syncState();
    wake();
  }, [reducedMotion, seek, syncState, wake]);

  const pause = useCallback(() => {
    playingRef.current = false;
    syncState();
  }, [syncState]);

  const replay = useCallback(() => {
    tRef.current = 0;
    play();
  }, [play]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else if (tRef.current >= TIMELINE_MONTHS) replay();
    else play();
  }, [pause, play, replay]);

  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  const subscribe = useCallback(
    (fn: Subscriber) => {
      subs.current.add(fn);
      wake();
      return () => {
        subs.current.delete(fn);
      };
    },
    [wake],
  );

  // Reduced motion: show the last frame from the start.
  useEffect(() => {
    if (reducedMotion) seek(TIMELINE_MONTHS);
  }, [reducedMotion, seek]);

  // Stop the clock while the tab is hidden or the simulation is off screen.
  useEffect(() => {
    const update = (onScreen: boolean) => {
      const v = onScreen && document.visibilityState === "visible";
      if (v === visibleRef.current) return;
      visibleRef.current = v;
      if (v) wake();
    };
    let onScreen = true;
    const onVis = () => update(onScreen);
    document.addEventListener("visibilitychange", onVis);
    const el = containerRef.current;
    const io = el
      ? new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          update(onScreen);
        })
      : null;
    if (el && io) io.observe(el);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
    };
  }, [containerRef, wake]);

  useEffect(
    () => () => {
      // Reset the handle too: React's dev double-mount runs this cleanup and then keeps the hook.
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      last.current = null;
    },
    [],
  );

  const getT = useCallback(() => tRef.current, []);

  return useMemo(
    () => ({ month, playing, ended, speed, reducedMotion, setSpeed, play, pause, toggle, replay, seek, getT, subscribe, wake }),
    [month, playing, ended, speed, reducedMotion, setSpeed, play, pause, toggle, replay, seek, getT, subscribe, wake],
  );
}

/**
 * Eases `cur` toward `target` (~90 ms time constant) with a linear floor, so any jump lands
 * exactly on the target within ~300 ms and the last frame shows the computed number, not a near miss.
 */
export function approach(cur: number, target: number, dt: number, instant: boolean, snap = 0.005, scale?: number): number {
  if (instant) return target;
  const diff = target - cur;
  if (Math.abs(diff) <= snap) return target;
  if (dt === 0) return cur + diff * 0.35;
  const eased = diff * (1 - Math.exp(-dt / 90));
  // `scale` is the value's full range, so even the last few dollars move at a steady pace.
  const floor = ((scale ?? Math.abs(target) + Math.abs(cur)) * dt) / 300;
  const step = Math.sign(diff) * Math.max(Math.abs(eased), Math.min(Math.abs(diff), floor));
  const next = cur + step;
  return Math.abs(target - next) <= snap ? target : next;
}
