import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { executeTool, riskLevelFromToolCalls } from "../src/agents/tools.js";
import { DomainEvent } from "../src/types.js";

function fakeEvent(type: DomainEvent["type"], payload: Record<string, unknown> = {}): DomainEvent {
  return {
    id: randomUUID(),
    patientId: "patient-1",
    runId: null,
    type,
    actorType: "system",
    actorName: "test",
    payload,
    createdAt: new Date().toISOString(),
  };
}

describe("executeTool", () => {
  it("get_patient_history summarizes prior runs and decisions from real history", async () => {
    const history: DomainEvent[] = [
      fakeEvent("TriageAgentCompleted", { riskLevel: "low" }),
      fakeEvent("ClinicianDecisionRecorded", { decision: "approved" }),
      fakeEvent("TriageAgentCompleted", { riskLevel: "low" }),
      fakeEvent("ClinicianDecisionRecorded", { decision: "rejected" }),
    ];

    const result = await executeTool({ name: "get_patient_history", input: {} }, { history });
    expect(result.output.prior_triage_runs).toBe(2);
    expect(result.output.prior_clinician_decisions).toEqual(["approved", "rejected"]);
    expect(result.output.event_count).toBe(4);
  });

  it("get_patient_history on a fresh patient reports zero history", async () => {
    const result = await executeTool({ name: "get_patient_history", input: {} }, { history: [] });
    expect(result.output.prior_triage_runs).toBe(0);
    expect(result.output.prior_clinician_decisions).toEqual([]);
  });

  it("flag_risk_level, draft_clinical_summary, and request_human_review echo their input as acknowledged", async () => {
    const ctx = { history: [] as DomainEvent[] };

    const flag = await executeTool(
      { name: "flag_risk_level", input: { risk_level: "high", justification: "acute indicators" } },
      ctx
    );
    expect(flag.output).toMatchObject({ acknowledged: true, risk_level: "high" });

    const draft = await executeTool(
      { name: "draft_clinical_summary", input: { summary: "x", recommended_next_step: "y" } },
      ctx
    );
    expect(draft.output).toMatchObject({ acknowledged: true, summary: "x" });

    const review = await executeTool(
      { name: "request_human_review", input: { reason: "done" } },
      ctx
    );
    expect(review.output).toMatchObject({ acknowledged: true, reason: "done" });
  });
});

describe("riskLevelFromToolCalls", () => {
  it("extracts the risk level from a flag_risk_level call", () => {
    const level = riskLevelFromToolCalls([
      { name: "get_patient_history", input: {} },
      { name: "flag_risk_level", input: { risk_level: "high", justification: "x" } },
    ]);
    expect(level).toBe("high");
  });

  it("defaults to moderate when no flag_risk_level call is present", () => {
    const level = riskLevelFromToolCalls([{ name: "get_patient_history", input: {} }]);
    expect(level).toBe("moderate");
  });

  it("defaults to moderate when risk_level is missing or malformed", () => {
    const level = riskLevelFromToolCalls([
      { name: "flag_risk_level", input: { justification: "no level given" } },
    ]);
    expect(level).toBe("moderate");
  });
});
