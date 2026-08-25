import type { DomainEvent } from "@/lib/api";

interface ToolCallPayload {
  tool_name?: string;
  input?: unknown;
  output?: unknown;
}

function mostRecentRunId(events: DomainEvent[]): string | null {
  // events arrive sorted ascending by createdAt -- walk backwards for the
  // last event that belongs to any run at all.
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].runId) return events[i].runId;
  }
  return null;
}

export function AgentReasoningPanel({ events }: { events: DomainEvent[] }) {
  const runId = mostRecentRunId(events);

  if (!runId) {
    return (
      <p className="text-sm text-slate-500">
        No triage run yet -- this is where the agent&apos;s tool-by-tool reasoning trace will
        show up once a run kicks off.
      </p>
    );
  }

  const toolCalls = events.filter((e) => e.type === "TriageToolCalled" && e.runId === runId);
  const errors = events.filter((e) => e.type === "AgentErrorOccurred" && e.runId === runId);

  if (toolCalls.length === 0 && errors.length === 0) {
    return <p className="text-sm text-slate-500">Triage agent is running -- no tool calls logged yet.</p>;
  }

  // Interleave by original event order rather than re-sorting, so retries
  // show up exactly where they happened relative to the tool calls.
  const merged = events.filter(
    (e) => e.runId === runId && (e.type === "TriageToolCalled" || e.type === "AgentErrorOccurred")
  );

  return (
    <ol className="space-y-3">
      {merged.map((event, i) => {
        if (event.type === "AgentErrorOccurred") {
          const p = event.payload as { error?: string; retry_count?: number; escalated?: boolean };
          return (
            <li
              key={event.id}
              className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"
            >
              <span className="font-medium">Retry #{i + 1}:</span> LLM call failed — {p.error ?? "unknown error"}
              {p.escalated ? " (escalated, retries exhausted)" : " (will retry)"}
            </li>
          );
        }
        const p = event.payload as ToolCallPayload;
        return (
          <li key={event.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
            <div className="font-medium text-slate-900">{p.tool_name ?? "unknown_tool"}</div>
            {p.input !== undefined && (
              <div className="mt-1">
                <span className="text-slate-500">input:</span>{" "}
                <code className="text-slate-700">{JSON.stringify(p.input)}</code>
              </div>
            )}
            {p.output !== undefined && (
              <div className="mt-1">
                <span className="text-slate-500">output:</span>{" "}
                <code className="text-slate-700">{JSON.stringify(p.output)}</code>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
