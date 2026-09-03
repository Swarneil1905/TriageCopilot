"use client";

import { useEffect, useRef, useState } from "react";

// The same five boxes and connections the old ASCII-art DIAGRAM const in
// how-it-works/page.tsx encoded, just rendered as a real diagram instead of
// monospace box-drawing characters: nothing here is invented, only
// re-labeled with the exact same text. Coordinates are a fixed design-time
// layout in a 680x480 viewBox; the SVG scales as one unit via a plain
// width:100% wrapper, so it stays legible at any container width rather
// than needing separate responsive breakpoints for a hand-laid-out diagram.
const NODES = [
  { id: "dashboard", x: 240, y: 10, w: 200, h: 54, title: "Next.js dashboard" },
  { id: "api", x: 240, y: 118, w: 200, h: 54, title: "Fastify REST API" },
  { id: "store", x: 30, y: 232, w: 270, h: 74, title: "Event store", sub: "Postgres, append-only" },
  {
    id: "orchestrator",
    x: 380,
    y: 232,
    w: 270,
    h: 74,
    title: "Triage agent orchestrator",
    sub: "tool loop + retries",
  },
  {
    id: "state-machine",
    x: 30,
    y: 366,
    w: 270,
    h: 74,
    title: "State machine",
    sub: "pure projection + invariant checks",
  },
  { id: "llm", x: 380, y: 366, w: 270, h: 74, title: "LLM provider", sub: "fake · anthropic · ollama" },
] as const;

// Elbow-routed connectors (right-angle segments, like the original ASCII's
// own layout) rather than diagonals, since that's what a real architecture
// diagram tool (and the ASCII art it's replacing) actually draws.
const EDGES = [
  { id: "dashboard-api", d: "M 340 64 L 340 118", label: "REST" },
  { id: "api-store", d: "M 340 172 L 340 200 L 165 200 L 165 232" },
  { id: "api-orchestrator", d: "M 340 172 L 340 200 L 515 200 L 515 232" },
  { id: "orchestrator-store", d: "M 380 269 L 300 269" },
  { id: "store-statemachine", d: "M 165 306 L 165 366" },
  { id: "orchestrator-llm", d: "M 515 306 L 515 366" },
] as const;

/** One connector: computes its own real path length via getTotalLength()
 * (no hardcoded/guessed number) and animates stroke-dashoffset from that
 * length down to 0 once `visible`, the exact technique StatRing.tsx already
 * uses for its progress ring, just applied to a path instead of a circle. */
function AnimatedEdge({ d, visible }: { d: string; visible: boolean }) {
  const ref = useRef<SVGPathElement>(null);
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (ref.current) setLength(ref.current.getTotalLength());
  }, []);

  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      stroke="#a8a29e"
      strokeWidth={2}
      markerEnd="url(#arrowhead)"
      strokeDasharray={length || 1}
      strokeDashoffset={visible ? 0 : length}
      className="transition-[stroke-dashoffset] duration-1000 ease-out"
    />
  );
}

export function ArchitectureDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setVisible(true);
      return;
    }
    const el = containerRef.current;
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

  return (
    <div ref={containerRef} className="surface-flat overflow-x-auto bg-stone-50 p-4">
      <svg viewBox="0 0 680 480" className="w-full min-w-[420px]" role="img" aria-label="TriageCopilot architecture: the dashboard calls the Fastify REST API, which reads from the event store and starts the triage orchestrator; the orchestrator writes back to the event store and calls the LLM provider, and the event store feeds the state machine.">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" fill="#a8a29e" />
          </marker>
        </defs>

        {EDGES.map((edge) => (
          <AnimatedEdge key={edge.id} d={edge.d} visible={visible} />
        ))}

        {/* "REST" edge label, the one piece of text the original ASCII art
            put directly on a connector rather than inside a box. */}
        <text x="350" y="95" className="font-mono-data" fontSize="11" fill="#78716c">
          REST
        </text>

        {NODES.map((node) => (
          <foreignObject key={node.id} x={node.x} y={node.y} width={node.w} height={node.h}>
            <div className="surface-flat flex h-full flex-col items-center justify-center px-3 text-center">
              <p className="font-mono-data text-xs leading-tight font-semibold text-stone-800">{node.title}</p>
              {"sub" in node && node.sub && (
                <p className="font-mono-data mt-1 text-[10px] leading-tight text-stone-500">{node.sub}</p>
              )}
            </div>
          </foreignObject>
        ))}
      </svg>
    </div>
  );
}
