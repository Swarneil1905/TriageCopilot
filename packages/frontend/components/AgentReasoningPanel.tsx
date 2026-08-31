"use client";

import { useEffect, useRef, useState } from "react";
import type { DomainEvent } from "@/lib/api";
import { providerLabel } from "@/lib/api";

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

const RISK_STYLES: Record<string, { bubble: string; badge: string }> = {
  low: { bubble: "border-emerald-200 bg-emerald-50", badge: "bg-emerald-100 text-emerald-800" },
  moderate: { bubble: "border-amber-200 bg-amber-50", badge: "bg-amber-100 text-amber-800" },
  high: { bubble: "border-rose-200 bg-rose-50", badge: "bg-rose-100 text-rose-800" },
};

const STEP_LABELS: Record<string, string> = {
  get_patient_history: "Looked up prior history",
  flag_risk_level: "Flagged a risk level",
  draft_clinical_summary: "Drafted a clinical summary",
  request_human_review: "Requested human review",
};

/** Plain-language line for one reasoning step, falling back to naming the
 * raw field for anything unrecognized. This is the only rendering this
 * panel ever does for a step's detail: there is still no separate JSON
 * view anywhere in this component. A chat shaped panel does not change
 * that, only the container changed: the people reading this are clinical
 * staff and site visitors, not engineers inspecting a raw payload. */
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

/** A small filled sparkle mark, not an emoji or an external icon font, so
 * the one avatar this panel needs stays a single inline SVG with no new
 * dependency. */
function AgentAvatar({ tone = "solid" }: { tone?: "solid" | "muted" }) {
  return (
    <div
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full " +
        (tone === "solid" ? "bg-teal-700 text-white" : "bg-stone-100 text-stone-400")
      }
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
        <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
      </svg>
    </div>
  );
}

type ChatItem =
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
  /** The landing page embeds this same panel specifically to show the
   * conversation off to a visitor, so it gets a taller message window; a
   * real patient page keeps it more compact in the sticky rail. Either way
   * the panel auto scrolls to its newest message on load, which is the
   * actual assessment, the same way opening any chat app lands you on the
   * latest message rather than the start of the history. */
  defaultTraceOpen?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const runId = mostRecentRunId(events);

  const runTimeline = runId ? events.filter((e) => e.runId === runId) : [];
  const finished = runTimeline.some((e) => e.type === "TriageAgentCompleted" || e.type === "HumanReviewRequested");

  const items: ChatItem[] = runTimeline
    .map((event, i) => ({ event, prevEvent: runTimeline[i - 1] }))
    .filter(
      ({ event }) =>
        event.type === "TriageToolCalled" || event.type === "AgentErrorOccurred" || event.type === "HumanReviewRequested"
    )
    .map(({ event, prevEvent }) => {
      if (event.type === "AgentErrorOccurred") return { kind: "error", event, prevEvent } as ChatItem;
      if (event.type === "HumanReviewRequested") return { kind: "handoff", event, prevEvent } as ChatItem;
      return { kind: "step", event: event as DomainEvent<ToolCallPayload>, prevEvent } as ChatItem;
    });

  const toolCalls = items
    .filter((i): i is Extract<ChatItem, { kind: "step" }> => i.kind === "step")
    .map((i) => i.event);
  const totalMs = msBetween(runTimeline[0], runTimeline[runTimeline.length - 1]);

  // Auto scroll to the newest message once the message list has actually
  // rendered, exactly like opening any real chat app: you land on the
  // latest message, not the start of the conversation.
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (mounted && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mounted, items.length]);

  const statusLine = !runId
    ? "No conversation yet"
    : items.length === 0 && !finished
      ? "Starting…"
      : !finished
        ? "Live · thinking"
        : `Completed in ${formatDuration(totalMs)} · ${toolCalls.length} step${toolCalls.length === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white">
      {/* Chat header, the same shape as any real messaging app: an avatar,
          the participant's name, and a one-line status underneath it. */}
      <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-3">
        <AgentAvatar />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">Triage Agent</p>
          <p className="truncate text-xs text-stone-400">{statusLine}</p>
        </div>
        <span className="ml-auto hidden shrink-0 text-xs text-stone-400 sm:inline">
          {llmProvider ? providerLabel(llmProvider) : "Provider unavailable"}
        </span>
      </div>

      {/* Message list: a fixed height scroll region so this reads as a real
          chat window rather than a page section that keeps growing, with
          the newest message (the actual assessment) already in view. */}
      <div
        ref={scrollRef}
        className={"space-y-3 overflow-y-auto px-4 py-4 " + (defaultTraceOpen ? "max-h-[30rem]" : "max-h-[20rem]")}
      >
        {!runId && <p className="py-6 text-center text-sm text-stone-400">No triage run yet for this patient.</p>}

        {runId && items.length === 0 && !finished && (
          <p className="py-6 text-center text-sm text-stone-400">Triage agent is starting up…</p>
        )}

        {items.map((item, i) => {
          if (item.kind === "error") {
            const p = item.event.payload;
            return (
              <div key={item.event.id} className="flex justify-center">
                <span className="max-w-[85%] rounded-full bg-stone-100 px-3 py-1 text-center text-xs text-stone-500">
                  Transient model error, retried automatically.
                  {p.escalated ? " Retries were exhausted, so this run was escalated for review." : ""}
                </span>
              </div>
            );
          }

          if (item.kind === "handoff") {
            const p = item.event.payload;
            const modelRequested = p.reason === "model-requested";
            return (
              <div key={item.event.id} className="flex justify-center py-1">
                <div className="flex max-w-[90%] items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-center text-xs text-stone-500">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-3.5 w-3.5 shrink-0 text-stone-400"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>
                    Handed off for human review,{" "}
                    {modelRequested ? "requested by the agent itself" : "enforced by the orchestrator regardless of what the agent did"}.
                  </span>
                </div>
              </div>
            );
          }

          const p = item.event.payload;
          const durationMs = msBetween(item.prevEvent, item.event);
          const label = (p.tool_name && STEP_LABELS[p.tool_name]) ?? p.tool_name ?? "Step";
          const riskLevel =
            p.tool_name === "flag_risk_level" ? String(p.input?.risk_level ?? p.output?.risk_level ?? "") : null;
          const riskStyle = riskLevel ? RISK_STYLES[riskLevel] : null;

          return (
            <div key={item.event.id} className="flex items-start gap-2.5">
              <AgentAvatar tone="muted" />
              <div className="min-w-0 max-w-[85%]">
                <div
                  className={
                    "rounded-2xl rounded-tl-sm border px-3.5 py-2.5 text-sm " +
                    (riskStyle ? riskStyle.bubble : "border-stone-100 bg-stone-50")
                  }
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-stone-800">{label}</span>
                    {riskLevel && riskStyle && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${riskStyle.badge}`}>
                        {riskLevel} risk
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-stone-600">
                    <StepDetail toolName={p.tool_name} input={p.input} output={p.output} />
                  </div>
                </div>
                <p className="mt-1 ml-1 text-[11px] text-stone-400">
                  {formatClock(item.event.createdAt)} · {formatDuration(durationMs)}
                  {i === 0 && " to first step"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-stone-100 px-4 py-2 text-center text-[11px] text-stone-400">
        Read-only replay of a logged run. Nothing here can be edited or sent.
      </div>
    </div>
  );
}
