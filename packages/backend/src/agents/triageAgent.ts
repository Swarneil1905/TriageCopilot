import { randomUUID } from "node:crypto";
import { EventLog } from "../eventLog.js";
import { DomainEvent, PatientWorldState } from "../types.js";
import { executeTool, riskLevelFromToolCalls, ToolCall } from "./tools.js";
import { LLMProvider, ProviderMessage, ProviderTurn, ToolResultBlock } from "./llmProvider.js";

const SYSTEM_PROMPT = `You are a psychiatric intake triage assistant working alongside licensed clinicians.

Your job for each patient is to:
1. Call get_patient_history to ground yourself in what has already happened for this patient.
2. Call flag_risk_level with your risk assessment and justification.
3. Call draft_clinical_summary with a structured, non-diagnostic summary and a recommended next step.
4. Call request_human_review to hand the case off.

You may never approve, deny, prescribe, or otherwise finalize a patient's care yourself. Your
output is always a draft for a licensed clinician to review, edit, or reject. Every run must end
with request_human_review -- that call is what hands the case to a human; nothing you do is final
until a clinician acts on it.`;

function summarizeIntakeForPrompt(history: DomainEvent[]): string {
  const intake = [...history].reverse().find((e) => e.type === "IntakeFormSubmitted");
  if (!intake) {
    return "A new patient has been created but has not yet submitted an intake form. Begin triage with whatever context tools provide.";
  }
  return `New intake to triage. Intake form payload: ${JSON.stringify(intake.payload)}`;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one LLM call with retry/backoff, logging an AgentErrorOccurred event
 * for *every* failed attempt (not just the final one) so the audit trail
 * shows exactly how flaky the run was. Only the final, exhausted attempt is
 * marked escalated: true -- that's the flag stateMachine.ts uses to force
 * the patient into urgent_review. Returns null if every attempt failed
 * (already logged, including the escalation); the caller stops the run.
 */
async function callWithRetryAndLogging(
  eventLog: EventLog,
  runId: string,
  fn: () => Promise<ProviderTurn>,
  maxAttempts: number,
  baseDelayMs: number
): Promise<ProviderTurn | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      await eventLog.append({
        runId,
        type: "AgentErrorOccurred",
        actorType: "agent",
        actorName: "triage-agent",
        payload: {
          error: err instanceof Error ? err.message : String(err),
          retry_count: attempt,
          escalated: isLastAttempt,
        },
      });
      if (isLastAttempt) return null;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return null;
}

export interface RunTriageAgentOptions {
  eventLog: EventLog;
  provider: LLMProvider;
  /** Cap on tool-calling turns, so a confused model can't loop forever. */
  maxTurns?: number;
  /** Retry attempts per LLM call before that call is considered permanently failed. */
  maxRetriesPerCall?: number;
  retryBaseDelayMs?: number;
}

/**
 * Orchestrates one triage run end to end. The important property to read
 * this function for: no matter which branch it exits through (clean
 * completion, model rambling past maxTurns without finishing, or permanent
 * LLM failure after retries), the patient never ends up silently
 * unreviewed. Either a clinician gets an explicit HumanReviewRequested
 * handoff, or the run escalates to urgent_review via AgentErrorOccurred.
 */
export async function runTriageAgent(opts: RunTriageAgentOptions): Promise<PatientWorldState> {
  const { eventLog, provider } = opts;
  const maxTurns = opts.maxTurns ?? 6;
  const maxRetries = opts.maxRetriesPerCall ?? 3;
  const retryBaseDelayMs = opts.retryBaseDelayMs ?? 50;

  const baselineHistory = await eventLog.getHistory();
  const runId = randomUUID();

  await eventLog.append({
    runId,
    type: "TriageAgentStarted",
    actorType: "agent",
    actorName: "triage-agent",
  });

  const messages: ProviderMessage[] = [
    { role: "user", content: [{ type: "text", text: summarizeIntakeForPrompt(baselineHistory) }] },
  ];

  const toolCallsThisRun: ToolCall[] = [];
  let sawRequestHumanReview = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const result = await callWithRetryAndLogging(
      eventLog,
      runId,
      () => provider.nextTurn(messages, { systemPrompt: SYSTEM_PROMPT }),
      maxRetries,
      retryBaseDelayMs
    );

    if (result === null) {
      // Permanently failed after retries; already logged and escalated.
      return eventLog.getState();
    }

    if (result.toolCalls.length === 0) {
      // Model believes it has nothing further to do this turn. If it never
      // called request_human_review, the guardrail below still fires.
      break;
    }

    messages.push({
      role: "assistant",
      content: result.toolCalls.map((tc) => ({
        type: "tool_use" as const,
        id: tc.id,
        name: tc.name,
        input: tc.input,
      })),
    });

    const toolResultBlocks: ToolResultBlock[] = [];
    for (const tc of result.toolCalls) {
      const toolResult = await executeTool({ name: tc.name, input: tc.input }, { history: baselineHistory });
      toolCallsThisRun.push({ name: tc.name, input: tc.input });

      await eventLog.append({
        runId,
        type: "TriageToolCalled",
        actorType: "agent",
        actorName: "triage-agent",
        payload: { tool_name: tc.name, input: tc.input, output: toolResult.output },
      });

      if (tc.name === "request_human_review") sawRequestHumanReview = true;

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: JSON.stringify(toolResult.output),
      });
    }
    messages.push({ role: "user", content: toolResultBlocks });

    if (sawRequestHumanReview) break;
  }

  const riskLevel = riskLevelFromToolCalls(toolCallsThisRun);
  const draftCall = toolCallsThisRun.find((c) => c.name === "draft_clinical_summary");
  const draftInput = draftCall?.input as { summary?: string; recommended_next_step?: string } | undefined;
  const summary = draftInput?.summary ?? "Agent ended its run without drafting a summary.";
  const recommendedNextStep = draftInput?.recommended_next_step ?? "Manual clinician review required.";

  // Orchestrator-enforced guardrail: these two events are written together,
  // atomically, regardless of whether the model itself ever called
  // request_human_review. The agent cannot finalize a case on its own --
  // the system prompt asks it to call the tool; this is what guarantees it
  // happens either way.
  await eventLog.appendMany([
    {
      runId,
      type: "TriageAgentCompleted",
      actorType: "agent",
      actorName: "triage-agent",
      payload: { riskLevel, summary, recommended_next_step: recommendedNextStep },
    },
    {
      runId,
      type: "HumanReviewRequested",
      actorType: "agent",
      actorName: "triage-agent",
      payload: {
        reason: sawRequestHumanReview
          ? "model-requested"
          : "orchestrator-enforced: model did not call request_human_review itself",
      },
    },
  ]);

  return eventLog.getState();
}
