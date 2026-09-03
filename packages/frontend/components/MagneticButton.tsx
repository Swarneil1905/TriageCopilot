"use client";

import { useRef, type MouseEvent, type ReactNode } from "react";

const MAX_OFFSET_PX = 8;

/**
 * A small magnetic-hover pull toward the cursor (clamped to a few pixels,
 * reset on mouse-leave) plus a press-state scale-down, the kind of
 * micro-interaction detail that reads as "someone tuned this" rather than
 * the default Tailwind hover-lift this app already had. Wraps its child in
 * a plain <span> and applies the transform there, rather than cloning the
 * handlers onto the child directly: next/link's Link only forwards a fixed
 * set of known props (onClick, onMouseEnter, onTouchStart, ...) to the
 * underlying <a>, silently dropping an arbitrary onMouseMove/onMouseLeave
 * passed to it, which a cloneElement-based version of this component
 * quietly relied on and never actually fired. A wrapping span sidesteps
 * that entirely: the Link's own hover:-translate-y-0.5 stays a separate,
 * independent transform on the child, composing naturally with this
 * span's own transform instead of the two fighting over one inline style.
 * Deliberately a plain mousemove handler and an inline transform, not a
 * new animation library: the same "cheap, dependency-free motion
 * primitive" instinct as Reveal.tsx and useScrollProgress. Skips the pull
 * itself under prefers-reduced-motion, the same check every other motion
 * primitive in this app makes.
 */
export function MagneticButton({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);

  function onMouseMove(e: MouseEvent<HTMLSpanElement>) {
    const el = ref.current;
    if (!el) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const relX = e.clientX - (rect.left + rect.width / 2);
    const relY = e.clientY - (rect.top + rect.height / 2);
    const x = Math.max(-MAX_OFFSET_PX, Math.min(MAX_OFFSET_PX, relX * 0.3));
    const y = Math.max(-MAX_OFFSET_PX, Math.min(MAX_OFFSET_PX, relY * 0.3));
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  function onMouseLeave() {
    const el = ref.current;
    if (el) el.style.transform = "";
  }

  return (
    <span
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="inline-block transition-transform duration-150 ease-out active:scale-[0.97]"
    >
      {children}
    </span>
  );
}
