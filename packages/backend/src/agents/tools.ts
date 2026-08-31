import type { DomainEvent, RiskLevel } from "../types.js";

// Tool definitions in Anthropic's tool-use schema shape. Kept separate from
// the provider so both the real Anthropic client and the offline FakeProvider
// share one contract: the orchestrator doesn't know or care which is live.

export const AGENT_TOOLS = [
  {
    name: "get_patient_history",
    description:
      "Fetch a summary of this patient's prior events (past intakes, triage runs, clinician decisions). Call this first to ground your triage in history rather than the intake form alone.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "flag_risk_level",
    description:
      "Record your risk assessment for this intake. This does NOT take any action by itself, it only sets a flag that determines how urgently a human clinician is alerted. You must always follow this with request_human_review.",
    input_schema: {
      type: "object",
      properties: {
        risk_level: { type: "string", enum: ["low", "moderate", "high"] },
        justification: { type: "string" },
      },
      required: ["risk_level", "justification"],
    },
  },
  {
    name: "draft_clinical_summary",
    description:
      "Draft a structured summary for the reviewing clinician. This is a DRAFT for a human to review, edit, or reject: it is never final and is never shown to the patient directly.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        recommended_next_step: { type: "string" },
      },
      required: ["summary", "recommended_next_step"],
    },
  },
  {
    name: "request_human_review",
    description:
      "REQUIRED final step. You may never approve, deny, prescribe, or close out a patient's triage yourself. Every triage run must end by handing off to a clinician via this tool.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
] as const;

export type ToolName = (typeof AGENT_TOOLS)[number]["name"];

export interface ToolCall {
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  name: ToolName;
  output: Record<string, unknown>;
}

/**
 * Tool execution lives outside the LLM call entirely: the model requests
 * a tool, and this function (not the model) decides what actually happens.
 * get_patient_history is the only tool that reads real data; the others are
 * pure "the model asserts something and we log it" actions, which is the
 * right shape for a domain where the agent should never be able to directly
 * mutate clinical state.
 */
export async function executeTool(
  call: ToolCall,
  ctx: { history: DomainEvent[] }
): Promise<ToolResult> {
  switch (call.name) {
    case "get_patient_history": {
      const priorRuns = ctx.history.filter((e) => e.type === "TriageAgentCompleted").length;
      const priorDecisions = ctx.history
        .filter((e) => e.type === "ClinicianDecisionRecorded")
        .map((e) => (e.payload as any).decision);
      return {
        name: call.name,
        output: {
          prior_triage_runs: priorRuns,
          prior_clinician_decisions: priorDecisions,
          event_count: ctx.history.length,
        },
      };
    }
    case "flag_risk_level":
      return { name: call.name, output: { acknowledged: true, ...call.input } };
    case "draft_clinical_summary":
      return { name: call.name, output: { acknowledged: true, ...call.input } };
    case "request_human_review":
      return { name: call.name, output: { acknowledged: true, ...call.input } };
  }
}

export function riskLevelFromToolCalls(calls: ToolCall[]): RiskLevel {
  const flag = calls.find((c) => c.name === "flag_risk_level");
  const level = (flag?.input as any)?.risk_level;
  return level === "high" || level === "moderate" || level === "low" ? level : "moderate";
}
