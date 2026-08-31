"use client";

import { useEffect, useRef, useState } from "react";

// Abridge's own stat sections use a circular progress ring (a solid stroke
// for the "achieved" portion, a dotted stroke for the remainder) instead of
// a plain percentage in a box, and it is the single most distinctive visual
// idea on their site. Reused here for the one stat this codebase has a real
// fraction for (51 of 51 backend tests passing), animating its stroke in on
// scroll into view via the same dependency-free IntersectionObserver
// technique Reveal.tsx already uses, not a new animation library.
export function StatRing({
  value,
  total,
  label,
  caption,
}: {
  value: number;
  total: number;
  label: string;
  caption: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pct = total > 0 ? value / total : 0;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="flex items-center gap-3">
      <svg ref={ref} viewBox="0 0 100 100" className="h-14 w-14 shrink-0 -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e7e5e4"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray="2 7"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="var(--color-rust)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={visible ? dashOffset : circumference}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div>
        <p className="font-display tracking-display text-2xl font-semibold text-stone-900">
          {label}
        </p>
        <p className="mt-1 text-xs leading-snug text-stone-500">{caption}</p>
      </div>
    </div>
  );
}
