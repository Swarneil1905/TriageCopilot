"use client";

import { useEffect, useRef, useState } from "react";
import type { DomainEvent, RiskLevel } from "@/lib/api";
import { providerLabel } from "@/lib/api";
import { RiskBadge } from "@/components/RiskBadge";

interface ToolCallPayload {
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

function mostRecentRunId(events: DomainEvent[]): string | null {
  // events arrive sorted ascending by createdAt, so walk backwards for the
  // last event that belongs to any run at all.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].runId) return events[i].runId;
  }
  return null;
}

/** Real elapsed time between two logged events, in milliseconds. Every
 * number this panel shows is derived straight from createdAt timestamps
 * already stored in the event log, never fabricated or estimated. */
function msBetween(a?: DomainEvent<any>, b?: DomainEvent<any>): number | null {
  if (!a || !b) return null;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "N/A";
  const clamped = Math.max(ms, 0);
  if (clamped < 1000) return `${Math.round(clamped)} ms`;
  return `${(clamped / 1000).toFixed(clamped >= 10000 ? 0 : 2)}s`;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const STEP_LABELS: Record<string, string> = {
  get_patient_history: "Looked up prior history",
  flag_risk_level: "Flagged a risk level",
  draft_clinical_summary: "Drafted a clinical summary",
  request_human_review: "Requested human review",
};

/** Plain-language line for one reasoning step, falling back to naming the
 * raw field for anything unrecognized. This is the only rendering this
 * panel ever does for a step's detail by default: the raw input/output is
 * still available, just behind the "View raw step" disclosure below, so an
 * engineer or a technically curious clinician can go one click deeper
 * without that JSON being load-bearing for everyone else reading this. */
function StepDetail({
  toolName,
  input,
  output,
}: {
  toolName?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}) {
  switch (toolName) {
    case "flag_risk_level":
      return <span>{String(input?.justification ?? output?.justification ?? "")}</span>;
    case "draft_clinical_summary":
      return (
        <span>
          {String(input?.summary ?? output?.summary ?? "")}
          {(input?.recommended_next_step ?? output?.recommended_next_step) ? (
            <>
              {" "}Recommended next step: {String(input?.recommended_next_step ?? output?.recommended_next_step ?? "")}
            </>
          ) : null}
        </span>
      );
    case "request_human_review":
      return <span>{String(input?.reason ?? output?.reason ?? "")}</span>;
    case "get_patient_history":
      return (
        <span>
          {String(output?.prior_triage_runs ?? 0)} prior triage run(s), {String(output?.event_count ?? 0)} event(s)
          on file.
        </span>
      );
    default:
      return <span>Step completed.</span>;
  }
}

/** A small, collapsed-by-default disclosure exposing the exact structured
 * input/output a tool call ran with. This is the "Linked Evidence" idea
 * product-notes.tsx already cites approvingly, made literal here: every
 * plain-language claim above has real structured evidence one click away,
 * without that evidence competing with the plain-language summary for a
 * first-time reader's attention. */
function RawStepDisclosure({ input, output }: { input?: Record<string, unknown>; output?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const hasPayload = (input && Object.keys(input).length > 0) || (output && Object.keys(output).length > 0);
  if (!hasPayload) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-teal-700 hover:underline"
      >
        {open ? "Hide raw step" : "View raw step"}
      </button>
      {open && (
        <pre className="mt-1.5 overflow-x-auto rounded-md bg-stone-50 p-2 text-[11px] leading-relaxed text-stone-700 ring-1 ring-stone-200">
          {JSON.stringify({ input, output }, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** The small circular rail marker every step/error/handoff row sits on,
 * matching Timeline.tsx's own "icon in a circle on a left-hand rail" idiom
 * (see ACTOR_ICON_SVG there) rather than a fourth, new visual language for
 * "here is a marker on a vertical line." A plain step gets its ordinal
 * number, the same numbered-rail idea already used for "How this is built"
 * and "What the architecture actually enforces" elsewhere in the app. */
function RailMarker({ tone, children }: { tone: "step" | "error" | "handoff"; children: React.ReactNode }) {
  const toneClass =
    tone === "error"
      ? "bg-amber-100 text-amber-700"
      : tone === "handoff"
        ? "bg-teal-100 text-teal-700"
        : "bg-stone-100 text-stone-500";
  return (
    <span
      className={"absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold " + toneClass}
    >
      {children}
    </span>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a1 1 0 00.86 1.5h18.64a1 1 0 00.86-1.5L13.71 3.86a1 1 0 00-1.72 0z" />
    </svg>
  );
}

function HandoffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

type TraceItem =
  | { kind: "step"; event: DomainEvent<ToolCallPayload>; prevEvent?: DomainEvent }
  | { kind: "error"; event: DomainEvent<{ error?: string; escalated?: boolean }>; prevEvent?: DomainEvent }
  | { kind: "handoff"; event: DomainEvent<{ reason?: string }>; prevEvent?: DomainEvent };

export function AgentReasoningPanel({
  events,
  llmProvider,
  defaultTraceOpen = false,
}: {
  events: DomainEvent[];
  llmProvider?: string;
  /** The landing page embeds this same panel specifically to show the trace
   * off to a visitor, so it gets a taller window; a real patient page keeps
   * it more compact in the sticky rail. Either way the panel auto-scrolls
   * to its newest step on load, the same reasonable default a log viewer or
   * a CI run's step list uses: land on the latest entry, not the start of
   * the history. */
  defaultTraceOpen?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const runId = mostRecentRunId(events);

  const runTimeline = runId ? events.filter((e) => e.runId === runId) : [];
  const finished = runTimeline.some((e) => e.type === "TriageAgentCompleted" || e.type === "HumanReviewRequested");

  const items: TraceItem[] = runTimeline
    .map((event, i) => ({ event, prevEvent: runTimeline[i - 1] }))
    .filter(
      ({ event }) =>
        event.type === "TriageToolCalled" || event.type === "AgentErrorOccurred" || event.type === "HumanReviewRequested"
    )
    .map(({ event, prevEvent }) => {
      if (event.type === "AgentErrorOccurred") return { kind: "error", event, prevEvent } as TraceItem;
      if (event.type === "HumanReviewRequested") return { kind: "handoff", event, prevEvent } as TraceItem;
      return { kind: "step", event: event as DomainEvent<ToolCallPayload>, prevEvent } as TraceItem;
    });

  const toolCalls = items
    .filter((i): i is Extract<TraceItem, { kind: "step" }> => i.kind === "step")
    .map((i) => i.event);
  const totalMs = msBetween(runTimeline[0], runTimeline[runTimeline.length - 1]);

  // Auto-scroll to the newest step once the step list has actually
  // rendered: a reasonable default for any log/trace viewer, landing on the
  // most recent entry rather than the start of the run.
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (mounted && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mounted, items.length]);

  const statusLine = !runId
    ? "No run yet"
    : items.length === 0 && !finished
      ? "Starting…"
      : !finished
        ? "Running…"
        : `Completed in ${formatDuration(totalMs)} · ${toolCalls.length} step${toolCalls.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
      {/* A named process that ran, not a chat participant: no avatar, no
          persona name, just what this panel is and its real status. */}
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">Agent trace</p>
          <p className="truncate text-xs text-stone-400">{statusLine}</p>
        </div>
        <span className="ml-auto hidden shrink-0 text-xs text-stone-400 sm:inline">
          {llmProvider ? providerLabel(llmProvider) : "Provider unavailable"}
        </span>
      </div>

      {/* Step list: a vertical trace, the same rail-with-circle-markers
          idiom Timeline.tsx already uses for the main event log, so the two
          panels that sit side by side on a patient page read as one
          designed system rather than two different eras of the app. */}
      <div
        ref={scrollRef}
        className={"overflow-y-auto px-4 py-4 " + (defaultTraceOpen ? "max-h-[30rem]" : "max-h-[20rem]")}
      >
        {!runId && <p className="py-6 text-center text-sm text-stone-400">No triage run yet for this patient.</p>}

        {runId && items.length === 0 && !finished && (
          <p className="py-6 text-center text-sm text-stone-400">Triage agent is starting up…</p>
        )}

        {items.length > 0 && (
          <ol className="space-y-4 border-l border-stone-200 pl-2">
            {items.map((item, i) => {
              if (item.kind === "error") {
                const p = item.event.payload;
                return (
                  <li key={item.event.id} className="relative pl-8">
                    <RailMarker tone="error">
                      <WarningIcon />
                    </RailMarker>
                    <p className="text-xs text-stone-500">
                      Transient model error, retried automatically.
                      {p.escalated ? " Retries were exhausted, so this run was escalated for review." : ""}
                    </p>
                  </li>
                );
              }

              if (item.kind === "handoff") {
                const p = item.event.payload;
                const modelRequested = p.reason === "model-requested";
                return (
                  <li key={item.event.id} className="relative pl-8">
                    <RailMarker tone="handoff">
                      <HandoffIcon />
                    </RailMarker>
                    <p className="text-xs text-stone-500">
                      Handed off for human review,{" "}
                      {modelRequested ? "requested by the agent itself" : "enforced by the orchestrator regardless of what the agent did"}.
                    </p>
                  </li>
                );
              }

              const p = item.event.payload;
              const durationMs = msBetween(item.prevEvent, item.event);
              const label = (p.tool_name && STEP_LABELS[p.tool_name]) ?? p.tool_name ?? "Step";
              const riskLevel =
                p.tool_name === "flag_risk_level"
                  ? (String(p.input?.risk_level ?? p.output?.risk_level ?? "") as RiskLevel | "")
                  : null;

              return (
                <li key={item.event.id} className="relative pl-8">
                  <RailMarker tone="step">{i + 1}</RailMarker>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-stone-900">{label}</span>
                      {riskLevel && <RiskBadge riskLevel={riskLevel} />}
                    </div>
                    <span className="font-mono-data shrink-0 text-[11px] text-stone-400">
                      {formatClock(item.event.createdAt)} · {formatDuration(durationMs)}
                      {i === 0 && " to first step"}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-stone-600">
                    <StepDetail toolName={p.tool_name} input={p.input} output={p.output} />
                  </div>
                  <RawStepDisclosure input={p.input} output={p.output} />
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="border-t border-stone-100 px-4 py-2 text-center text-[11px] text-stone-400">
        Read-only trace of a completed run. Nothing here can be edited or resent.
      </div>
    </div>
  );
}
