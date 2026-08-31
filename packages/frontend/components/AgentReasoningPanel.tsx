"use client";

import { useState } from "react";
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
function msBetween(a?: DomainEvent, b?: DomainEvent): number | null {
  if (!a || !b) return null;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "N/A";
  const clamped = Math.max(ms, 0);
  if (clamped < 1000) return `${Math.round(clamped)} ms`;
  return `${(clamped / 1000).toFixed(clamped >= 10000 ? 0 : 2)}s`;
}

const RISK_ACCENT: Record<string, string> = {
  low: "border-emerald-400",
  moderate: "border-amber-400",
  high: "border-rose-400",
};

const STEP_LABELS: Record<string, string> = {
  get_patient_history: "Looked up prior history",
  flag_risk_level: "Flagged a risk level",
  draft_clinical_summary: "Drafted a clinical summary",
  request_human_review: "Requested human review",
};

/** Plain-language line for one reasoning step, falling back to naming the
 * raw field for anything unrecognized. This is the only rendering this
 * panel ever does for a step's detail: there is no separate JSON view, here
 * or anywhere else in this component, because the people reading this panel
 * are clinical staff, not engineers inspecting a payload. */
function StepDetail({ toolName, input, output }: { toolName?: string; input?: Record<string, unknown>; output?: Record<string, unknown> }) {
  switch (toolName) {
    case "flag_risk_level":
      return (
        <span>
          <span className="font-medium capitalize">{String(input?.risk_level ?? output?.risk_level ?? "unknown")} risk.</span>{" "}
          {String(input?.justification ?? output?.justification ?? "")}
        </span>
      );
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

export function AgentReasoningPanel({
  events,
  llmProvider,
  defaultTraceOpen = false,
}: {
  events: DomainEvent[];
  llmProvider?: string;
  /** The landing page embeds this same panel specifically to show the trace
   * off to a technical visitor, so it opens expanded there. On a real
   * patient page, clinical staff get the assessment first and open the
   * reasoning steps themselves if they want them. */
  defaultTraceOpen?: boolean;
}) {
  const [showSteps, setShowSteps] = useState(defaultTraceOpen);
  const runId = mostRecentRunId(events);

  if (!runId) {
    return (
      <p className="text-sm text-stone-500">
        No triage run yet. Once a run starts, its assessment will appear here.
      </p>
    );
  }

  // Full timeline for this run, in the order events actually happened, so
  // each step's duration below is measured against the event that really
  // preceded it.
  const runTimeline = events.filter((e) => e.runId === runId);
  const finished = runTimeline.some((e) => e.type === "TriageAgentCompleted" || e.type === "HumanReviewRequested");

  const steps = runTimeline
    .map((event, i) => ({ event, prevEvent: runTimeline[i - 1] }))
    .filter(({ event }) => event.type === "TriageToolCalled" || event.type === "AgentErrorOccurred");

  const toolCalls = steps
    .map((s) => s.event)
    .filter((e) => e.type === "TriageToolCalled") as DomainEvent<ToolCallPayload>[];

  function findToolCall(toolName: string): ToolCallPayload | undefined {
    return toolCalls.find((e) => e.payload.tool_name === toolName)?.payload;
  }

  const riskCall = findToolCall("flag_risk_level");
  const summaryCall = findToolCall("draft_clinical_summary");

  const riskLevel = riskCall ? String(riskCall.input?.risk_level ?? riskCall.output?.risk_level ?? "") : null;
  const justification = riskCall
    ? String(riskCall.input?.justification ?? riskCall.output?.justification ?? "")
    : null;
  const summary = summaryCall ? String(summaryCall.input?.summary ?? summaryCall.output?.summary ?? "") : null;
  const nextStep = summaryCall
    ? String(summaryCall.input?.recommended_next_step ?? summaryCall.output?.recommended_next_step ?? "")
    : null;

  const hasAssessment = Boolean(riskLevel || summary);
  const totalMs = msBetween(runTimeline[0], runTimeline[runTimeline.length - 1]);

  return (
    <div>
      {hasAssessment ? (
        <div className="space-y-4 text-sm text-stone-700">
          {riskLevel && (
            <div className={`border-l-2 pl-3 ${RISK_ACCENT[riskLevel] ?? "border-stone-300"}`}>
              <p className="font-semibold text-stone-900">
                Risk level: <span className="capitalize">{riskLevel}</span>
              </p>
              {justification && <p className="mt-1 text-stone-600">{justification}</p>}
            </div>
          )}
          {summary && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Assessment</h4>
              <p className="mt-1">{summary}</p>
            </div>
          )}
          {nextStep && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-400">Recommended next step</h4>
              <p className="mt-1">{nextStep}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-stone-500">
          {finished
            ? "The agent completed this run without producing an assessment."
            : "Triage agent is running. Its assessment will appear here as soon as it drafts one."}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 text-xs text-stone-400">
        <span>{llmProvider ? providerLabel(llmProvider) : "Provider unavailable"}</span>
        {steps.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="font-medium text-teal-700 hover:underline"
          >
            {showSteps ? "Hide reasoning steps" : "Show reasoning steps"}
          </button>
        )}
      </div>

      {showSteps && steps.length > 0 && (
        <div className="mt-3">
          <div className="divide-y divide-stone-100 border-t border-stone-100">
            {steps.map(({ event, prevEvent }, i) => {
              const durationMs = msBetween(prevEvent, event);
              if (event.type === "AgentErrorOccurred") {
                const p = event.payload as { error?: string; escalated?: boolean };
                return (
                  <div key={event.id} className="grid grid-cols-[2rem_1fr] gap-3 py-2.5">
                    <span className="font-mono-data pt-0.5 text-xs text-stone-300">{String(i + 1).padStart(2, "0")}</span>
                    <p className="text-xs text-rose-700">
                      Transient model error, retried automatically.
                      {p.escalated ? " Retries were exhausted, so this run was escalated for review." : ""}
                    </p>
                  </div>
                );
              }
              const p = event.payload as ToolCallPayload;
              const label = (p.tool_name && STEP_LABELS[p.tool_name]) ?? p.tool_name ?? "Step";
              return (
                <div key={event.id} className="grid grid-cols-[2rem_1fr] gap-3 py-2.5">
                  <span className="font-mono-data pt-0.5 text-xs text-stone-300">{String(i + 1).padStart(2, "0")}</span>
                  <div className="text-xs text-stone-600">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-stone-800">{label}</span>
                      <span className="font-mono-data text-stone-400">{formatDuration(durationMs)}</span>
                    </div>
                    <div className="mt-0.5">
                      <StepDetail toolName={p.tool_name} input={p.input} output={p.output} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2.5 text-xs text-stone-400">
            Completed in {formatDuration(totalMs)} across {toolCalls.length} step{toolCalls.length === 1 ? "" : "s"}.
          </p>
        </div>
      )}
    </div>
  );
}
