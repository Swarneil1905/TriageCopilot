"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small, dependency-free scroll reveal: fades and rises a section into
 * place the first time it enters the viewport, then leaves it alone. This
 * is the same technique Abridge and Nabla's own marketing sites use (via
 * GSAP's ScrollTrigger) to make a page feel considered rather than static;
 * here it is a plain IntersectionObserver instead, since a full animation
 * library is more than a handful of one-shot fades need. The easing is a
 * springier "ease-out-expo" curve (framer.com's own site, and most
 * production-value marketing sites right now, lean on this rather than a
 * flat ease-out) rather than a rebrand of the timing itself: same 700ms
 * duration, same fade+rise distance. Respects prefers-reduced-motion via
 * the .reveal-on-scroll rule in globals.css.
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -64px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={
        "reveal-on-scroll transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] " +
        (visible ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0") +
        " " +
        className
      }
      style={{ transitionDelay: visible ? `${delayMs}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

/**
 * Cascades a list of children in with a per-child delay, instead of every
 * call site hand-computing delayMs={i * 90} on its own Reveal (page.tsx did
 * this three separate times before this pass). Each entry in `children`
 * becomes its own Reveal, sharing `itemClassName`, staggered by `stagger`
 * ms per index; pass a Fragment per entry (not a wrapping div) when the
 * grid/flex classes on itemClassName expect its children to sit directly
 * inside it, the same layout contract a single hand-written Reveal already
 * has today.
 */
export function RevealGroup({
  children,
  itemClassName = "",
  stagger = 90,
}: {
  children: React.ReactNode[];
  itemClassName?: string;
  stagger?: number;
}) {
  return (
    <>
      {children.map((child, i) => (
        <Reveal key={i} delayMs={i * stagger} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </>
  );
}
