import { describe, it, expect } from "vitest";
import { InMemoryEventLog } from "../src/eventLog.js";
import { runTriageAgent } from "../src/agents/triageAgent.js";
import { FakeProvider, ProviderTurn } from "../src/agents/llmProvider.js";

async function makeIntakeSubmittedLog(patientId: string, displayName: string): Promise<InMemoryEventLog> {
  const log = new InMemoryEventLog(patientId, displayName);
  await log.append({ type: "PatientCreated", actorType: "system", actorName: "intake-service" });
  await log.append({
    type: "IntakeFormSubmitted",
    actorType: "system",
    actorName: "intake-service",
    payload: { chief_complaint: "low mood, trouble sleeping" },
  });
  return log;
}

const HAPPY_PATH_SCRIPT: ProviderTurn[] = [
  { toolCalls: [{ id: "call-1", name: "get_patient_history", input: {} }], text: null },
  {
    toolCalls: [
      { id: "call-2", name: "flag_risk_level", input: { risk_level: "low", justification: "no acute risk indicators" } },
    ],
    text: null,
  },
  {
    toolCalls: [
      {
        id: "call-3",
        name: "draft_clinical_summary",
        input: { summary: "Mild, situational low mood.", recommended_next_step: "Routine follow-up in 2 weeks." },
      },
    ],
    text: null,
  },
  {
    toolCalls: [{ id: "call-4", name: "request_human_review", input: { reason: "routine triage complete" } }],
    text: null,
  },
];

describe("runTriageAgent", () => {
  it("happy path: completes via the model's own request_human_review call", async () => {
    const log = await makeIntakeSubmittedLog("patient-A", "Test Patient");
    const provider = new FakeProvider({ script: HAPPY_PATH_SCRIPT });

    const state = await runTriageAgent({ eventLog: log, provider });

    expect(state.status).toBe("pending_clinician_review");
    expect(state.riskLevel).toBe("low");

    const history = await log.getHistory();
    expect(history.filter((e) => e.type === "TriageToolCalled")).toHaveLength(4);
    const review = history.find((e) => e.type === "HumanReviewRequested");
    expect((review!.payload as any).reason).toBe("model-requested");
  });

  it("forces a HumanReviewRequested handoff even if the model's script never calls request_human_review", async () => {
    const log = await makeIntakeSubmittedLog("patient-B", "Test Patient");
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null },
        {
          toolCalls: [{ id: "2", name: "flag_risk_level", input: { risk_level: "low", justification: "x" } }],
          text: null,
        },
        // Script ends here -- model never drafts a summary or requests review.
      ],
    });

    const state = await runTriageAgent({ eventLog: log, provider, maxTurns: 4 });

    const review = (await log.getHistory()).find((e) => e.type === "HumanReviewRequested");
    expect(review).toBeDefined();
    expect((review!.payload as any).reason).toMatch(/orchestrator-enforced/);
    // Guardrail fired, but the risk level the model DID flag is still honored.
    expect(state.status).toBe("pending_clinician_review");
    expect(state.riskLevel).toBe("low");
  });

  it("logs one AgentErrorOccurred per transient failure, then completes normally once the provider recovers", async () => {
    const log = await makeIntakeSubmittedLog("patient-C", "Test Patient");
    const provider = new FakeProvider({ failFirstNCalls: 2, script: HAPPY_PATH_SCRIPT });

    const state = await runTriageAgent({
      eventLog: log,
      provider,
      maxRetriesPerCall: 3,
      retryBaseDelayMs: 1,
    });

    const errors = (await log.getHistory()).filter((e) => e.type === "AgentErrorOccurred");
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => (e.payload as any).escalated === false)).toBe(true);

    // The run still reached a normal, reviewed outcome -- transient failures
    // did not strand the patient.
    expect(state.status).toBe("pending_clinician_review");
  });

  it("escalates to urgent_review when the provider fails on every retry attempt", async () => {
    const log = await makeIntakeSubmittedLog("patient-D", "Test Patient");
    const provider = new FakeProvider({ failFirstNCalls: 999, script: [] });

    const state = await runTriageAgent({
      eventLog: log,
      provider,
      maxRetriesPerCall: 3,
      retryBaseDelayMs: 1,
    });

    expect(state.status).toBe("urgent_review");
    expect(state.safetyAlert).toMatch(/failed after retries/);

    const errors = (await log.getHistory()).filter((e) => e.type === "AgentErrorOccurred");
    expect(errors).toHaveLength(3);
    expect(errors[errors.length - 1].payload).toMatchObject({ escalated: true });
    // No HumanReviewRequested here -- the run never reached a completed
    // triage to hand off; urgent_review is reached via the escalation path,
    // not the forced-handoff path.
    expect((await log.getHistory()).some((e) => e.type === "HumanReviewRequested")).toBe(false);
  });

  it("routes a high-risk flag straight to urgent_review", async () => {
    const log = await makeIntakeSubmittedLog("patient-E", "Test Patient");
    const provider = new FakeProvider({
      script: [
        { toolCalls: [{ id: "1", name: "get_patient_history", input: {} }], text: null },
        {
          toolCalls: [
            { id: "2", name: "flag_risk_level", input: { risk_level: "high", justification: "acute risk indicators" } },
          ],
          text: null,
        },
        { toolCalls: [{ id: "3", name: "request_human_review", input: { reason: "urgent" } }], text: null },
      ],
    });

    const state = await runTriageAgent({ eventLog: log, provider });

    expect(state.status).toBe("urgent_review");
    expect(state.riskLevel).toBe("high");
  });

  it("forces completion + a review handoff even if the model keeps calling tools past maxTurns", async () => {
    const log = await makeIntakeSubmittedLog("patient-F", "Test Patient");
    // A script that just keeps looking up history forever and never wraps up.
    const provider = new FakeProvider({
      script: Array.from({ length: 10 }, (_, i) => ({
        toolCalls: [{ id: `call-${i}`, name: "get_patient_history" as const, input: {} }],
        text: null,
      })),
    });

    const state = await runTriageAgent({ eventLog: log, provider, maxTurns: 3 });

    expect(["pending_clinician_review", "urgent_review"]).toContain(state.status);
    const review = (await log.getHistory()).find((e) => e.type === "HumanReviewRequested");
    expect(review).toBeDefined();
    expect((review!.payload as any).reason).toMatch(/orchestrator-enforced/);
  });
});
