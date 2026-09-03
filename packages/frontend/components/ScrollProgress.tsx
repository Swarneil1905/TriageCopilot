"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_RANGE: [number, number] = [0, 1];

/**
 * Tracks 0 -> 1 as an element crosses the viewport, for effects that
 * should move continuously with scroll rather than toggle once (compare
 * Reveal.tsx's one-shot IntersectionObserver, which only ever flips
 * opacity/position on and off). Kept dependency-free, the same instinct as
 * every other motion primitive in this app: a plain scroll listener
 * recomputing a ratio from getBoundingClientRect, not a new animation
 * library. Respects prefers-reduced-motion itself (the same check
 * StatRing.tsx already uses) so every consumer gets that for free instead
 * of having to remember to guard it individually: progress simply never
 * leaves its resting 0, so anything driven by it renders its static state.
 */
export function useScrollProgress<T extends HTMLElement>(range: [number, number] = DEFAULT_RANGE) {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  const [start, end] = range;

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const el = ref.current;
    if (!el) return;
    function onScroll() {
      const rect = el!.getBoundingClientRect();
      const vh = window.innerHeight;
      const raw = 1 - (rect.top + rect.height * start) / (vh - rect.height * (end - start));
      setProgress(Math.min(1, Math.max(0, raw)));
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [start, end]);

  return { ref, progress };
}
