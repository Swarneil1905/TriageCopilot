"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small, dependency-free scroll reveal: fades and rises a section into
 * place the first time it enters the viewport, then leaves it alone. This
 * is the same technique Abridge and Nabla's own marketing sites use (via
 * GSAP's ScrollTrigger) to make a page feel considered rather than static;
 * here it is a plain IntersectionObserver instead, since a full animation
 * library is more than a handful of one-shot fades need. Respects
 * prefers-reduced-motion via the .reveal-on-scroll rule in globals.css.
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
        "reveal-on-scroll transition-all duration-700 ease-out " +
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
