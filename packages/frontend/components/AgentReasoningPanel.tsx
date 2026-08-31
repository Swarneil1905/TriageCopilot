import type { ReactElement } from "react";
import type { DomainEvent } from "@/lib/api";
import { providerLabel } from "@/lib/api";

interface ToolCallPayload {
  tool_name?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

function mostRecentRunId(events: DomainEvent[]): string | null {
  // events arrive sorted ascending by createdAt -- walk backwards for the
  // last event that belongs to any run at all.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].runId) return events[i].runId;
  }
  return null;
}

const TOOL_META: Record<string, { label: string; icon: ReactElement }> = {
  get_patient_history: {
    label: "Looked up prior history",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2.5" strokeLinecap="round" />
      </svg>
    ),
  },
  flag_risk_level: {
    label: "Flagged a risk level",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
        <path d="M6 3v18" strokeLinecap="round" />
        <path d="M6 4h11l-2.5 3.5L17 11H6" strokeLinejoin="round" />
      </svg>
    ),
  },
  draft_clinical_summary: {
    label: "Drafted a clinical summary",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
        <path d="M6 3h9l3 3v15H6z" strokeLinejoin="round" />
        <path d="M9 11h6M9 15h6" strokeLinecap="round" />
      </svg>
    ),
  },
  request_human_review: {
    label: "Requested human review",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" strokeLinecap="round" />
        <path d="M16 4l2 2 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
};

const DEFAULT_TOOL_META = {
  label: null,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008.6 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 8.6a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H8a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V8a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

/** Renders a tool call's input/output as plain-language detail lines where the
 * shape is known, falling back to raw JSON for anything unrecognized so
 * nothing is ever silently hidden. */
function DetailLines({ toolName, input, output }: { toolName?: string; input?: Record<string, unknown>; output?: Record<string, unknown> }) {
  switch (toolName) {
    case "flag_risk_level":
      return (
        <>
          <div>
            <span className="font-medium capitalize">{String(input?.risk_level ?? output?.risk_level ?? "unknown")} risk.</span>{" "}
            {String(input?.justification ?? output?.justification ?? "")}
          </div>
        </>
      );
    case "draft_clinical_summary":
      return (
        <>
          <div>{String(input?.summary ?? output?.summary ?? "")}</div>
          <div className="mt-1 text-stone-500">
            Recommended next step: {String(input?.recommended_next_step ?? output?.recommended_next_step ?? "")}
          </div>
        </>
      );
    case "request_human_review":
      return <div>{String(input?.reason ?? output?.reason ?? "")}</div>;
    case "get_patient_history":
      return (
        <div className="text-stone-500">
          {String(output?.prior_triage_runs ?? 0)} prior triage run(s), {String(output?.event_count ?? 0)} event(s) on
          file.
        </div>
      );
    default:
      return (
        <>
          {input !== undefined && (
            <div className="mt-1">
              <span className="text-stone-500">input:</span> <code className="text-stone-700">{JSON.stringify(input)}</code>
            </div>
          )}
          {output !== undefined && (
            <div className="mt-1">
              <span className="text-stone-500">output:</span> <code className="text-stone-700">{JSON.stringify(output)}</code>
            </div>
          )}
        </>
      );
  }
}

export function AgentReasoningPanel({ events, llmProvider }: { events: DomainEvent[]; llmProvider?: string }) {
  const runId = mostRecentRunId(events);

  const header = llmProvider ? (
    <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800">
      <span className="h-1.5 w-1.5 rounded-full bg-teal-600" />
      Powered by {providerLabel(llmProvider)}
    </div>
  ) : null;

  if (!runId) {
    return (
      <div>
        {header}
        <p className="text-sm text-stone-500">
          No triage run yet -- this is where the agent&apos;s tool-by-tool reasoning trace will show up once a run
          kicks off.
        </p>
      </div>
    );
  }

  const toolCalls = events.filter((e) => e.type === "TriageToolCalled" && e.runId === runId);
  const errors = events.filter((e) => e.type === "AgentErrorOccurred" && e.runId === runId);

  if (toolCalls.length === 0 && errors.length === 0) {
    return (
      <div>
        {header}
        <p className="text-sm text-stone-500">Triage agent is running -- no tool calls logged yet.</p>
      </div>
    );
  }

  // Interleave by original event order rather than re-sorting, so retries
  // show up exactly where they happened relative to the tool calls.
  const merged = events.filter(
    (e) => e.runId === runId && (e.type === "TriageToolCalled" || e.type === "AgentErrorOccurred")
  );

  return (
    <div>
      {header}
      <ol className="space-y-3">
        {merged.map((event, i) => {
          if (event.type === "AgentErrorOccurred") {
            const p = event.payload as { error?: string; retry_count?: number; escalated?: boolean };
            return (
              <li key={event.id} className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                <span className="font-medium">Retry #{i + 1}:</span> LLM call failed - {p.error ?? "unknown error"}
                {p.escalated ? " (escalated, retries exhausted)" : " (will retry)"}
              </li>
            );
          }
          const p = event.payload as ToolCallPayload;
          const meta = (p.tool_name && TOOL_META[p.tool_name]) || DEFAULT_TOOL_META;
          const displayLabel = meta.label ?? p.tool_name ?? "unknown_tool";
          return (
            <li key={event.id} className="rounded-md border border-stone-200 bg-white p-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-stone-900">
                <span className="text-teal-700">{meta.icon}</span>
                {displayLabel}
              </div>
              <div className="mt-1 pl-6 text-stone-700">
                <DetailLines toolName={p.tool_name} input={p.input} output={p.output} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
