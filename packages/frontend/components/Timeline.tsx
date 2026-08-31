"use client";

import { useState, type ReactElement } from "react";
import type { DomainEvent } from "@/lib/api";

function formatEventType(type: string): string {
  // "IntakeFormSubmitted" -> "Intake Form Submitted"
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Small, deliberate icon set per actor type, replacing raw emoji, which
// read as a placeholder rather than a considered choice. Same stroke
// weight/style as AgentReasoningPanel's tool icons so the two panels feel
// like one designed system rather than two different eras of the app.
const ACTOR_ICON_SVG: Record<string, ReactElement> = {
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  agent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5">
      <rect x="4" y="8" width="16" height="12" rx="2" />
      <path d="M12 8V4" strokeLinecap="round" />
      <circle cx="12" cy="3" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="14" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  ),
  clinician: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-3.5 w-3.5">
      <path d="M9 3v6a3 3 0 006 0V3" strokeLinecap="round" />
      <path d="M9 9a3 3 0 006 0" strokeLinecap="round" />
      <path d="M6 9v2a6 6 0 0012 0V9" strokeLinecap="round" />
      <circle cx="18" cy="17" r="2" />
    </svg>
  ),
};

function EventRow({ event }: { event: DomainEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li className="relative pl-8">
      <span className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-100 text-stone-500">
        {ACTOR_ICON_SVG[event.actorType] ?? (
          <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
        )}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-stone-900">{formatEventType(event.type)}</span>
          <span className="text-xs text-stone-500">
            {event.actorType} · {event.actorName}
          </span>
        </div>
        <time className="text-xs text-stone-400" dateTime={event.createdAt}>
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
      {hasPayload && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-teal-600 hover:underline"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && hasPayload && (
        <pre className="mt-1 overflow-x-auto rounded-md bg-stone-50 p-2 text-xs text-stone-700 ring-1 ring-stone-200">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function Timeline({ events }: { events: DomainEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-stone-500">No events yet.</p>;
  }
  return (
    <ol className="space-y-4 border-l border-stone-200 pl-2">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ol>
  );
}
