"use client";

import { useScrollProgress } from "@/components/ScrollProgress";

/**
 * Two soft, blurred gradient orbs behind the hero's text column, in the
 * app's own teal and rust accent colors at low opacity, rather than the
 * hero staying a single flat gradient layer. Subtly parallaxes on scroll
 * via useScrollProgress, transform/opacity only so it stays GPU-cheap, and
 * simply stays put (progress never leaves 0) under prefers-reduced-motion,
 * since that check lives once inside the hook itself.
 */
export function HeroOrbs() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>([0, 1]);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
      <div
        className="absolute -top-24 -left-24 h-[26rem] w-[26rem] rounded-full bg-teal-400/20 blur-3xl will-change-transform"
        style={{ transform: `translate3d(0, ${progress * 40}px, 0) scale(${1 + progress * 0.08})` }}
      />
      <div
        className="absolute -right-32 -bottom-24 h-[22rem] w-[22rem] rounded-full bg-[var(--color-rust)]/20 blur-3xl will-change-transform"
        style={{ transform: `translate3d(0, ${progress * -30}px, 0) scale(${1 + progress * 0.05})` }}
      />
    </div>
  );
}
