"use client";

import { useState } from "react";
import type { DomainEvent } from "@/lib/api";
import { ACTOR_ICON } from "@/lib/statusMeta";

function formatEventType(type: string): string {
  // "IntakeFormSubmitted" -> "Intake Form Submitted"
  return type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function EventRow({ event }: { event: DomainEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li className="relative pl-8">
      <span className="absolute left-0 top-0.5 text-base leading-none">
        {ACTOR_ICON[event.actorType] ?? "•"}
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm text-slate-900">{formatEventType(event.type)}</span>
          <span className="text-xs text-slate-500">
            {event.actorType} · {event.actorName}
          </span>
        </div>
        <time className="text-xs text-slate-400" dateTime={event.createdAt}>
          {new Date(event.createdAt).toLocaleString()}
        </time>
      </div>
      {hasPayload && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-600 hover:underline"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      )}
      {expanded && hasPayload && (
        <pre className="mt-1 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700 ring-1 ring-slate-200">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function Timeline({ events }: { events: DomainEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-slate-500">No events yet.</p>;
  }
  return (
    <ol className="space-y-4 border-l border-slate-200 pl-2">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ol>
  );
}
