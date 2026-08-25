import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { assertValidAppend, projectPatientState } from "../src/stateMachine.js";
import { DomainEvent, EventType, InvariantViolationError } from "../src/types.js";

const PATIENT_ID = "patient-1";
const DISPLAY_NAME = "Synthetic Patient";

let clock = 0;
function ev<P extends Record<string, unknown>>(
  type: EventType,
  actorType: DomainEvent["actorType"],
  actorName: string,
  payload: P,
  runId: string | null = null
): DomainEvent<P> {
  clock += 1;
  return {
    id: randomUUID(),
    patientId: PATIENT_ID,
    runId,
    type,
    actorType,
    actorName,
    payload,
    createdAt: new Date(2026, 0, 1, 0, 0, clock).toISOString(),
  };
}

describe("projectPatientState", () => {
  it("walks the full happy path to follow_up_scheduled", () => {
    const runId = "run-1";
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", { chief_complaint: "low mood" }),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
      ev(
        "TriageToolCalled",
        "agent",
        "triage-agent",
        { tool_name: "get_patient_history", input: {}, output: {} },
        runId
      ),
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "low", summary: "stable", recommended_next_step: "routine follow-up" },
        runId
      ),
      ev("HumanReviewRequested", "agent", "triage-agent", { reason: "routine" }, runId),
      ev("ClinicianDecisionRecorded", "clinician", "Dr. Rivera", { decision: "approved", note: "agreed" }),
      ev("FollowUpScheduled", "system", "scheduler", { date: "2026-02-01", method: "video" }),
    ];

    const state = projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
    expect(state.status).toBe("follow_up_scheduled");
    expect(state.riskLevel).toBe("low");
    expect(state.safetyAlert).toBeNull();
  });

  it("routes a high-risk triage to urgent_review, not pending_clinician_review", () => {
    const runId = "run-2";
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "high", summary: "acute risk indicators", recommended_next_step: "same-day review" },
        runId
      ),
      ev("HumanReviewRequested", "agent", "triage-agent", { reason: "high risk" }, runId),
    ];

    const state = projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
    expect(state.status).toBe("urgent_review");
    expect(state.nextAction).toMatch(/URGENT/);
  });

  it("allows a rejected triage to loop back into a fresh run", () => {
    const runId1 = "run-3";
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId1),
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "low", summary: "x", recommended_next_step: "y" },
        runId1
      ),
      ev("HumanReviewRequested", "agent", "triage-agent", { reason: "r" }, runId1),
      ev("ClinicianDecisionRecorded", "clinician", "Dr. Rivera", { decision: "rejected", note: "re-check history" }),
    ];

    const state = projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
    expect(state.status).toBe("clinician_rejected");

    // Starting a fresh run from clinician_rejected must be legal.
    expect(() => assertValidAppend(state, "TriageAgentStarted", "run-4")).not.toThrow();
  });

  it("defense-in-depth: a completed triage with no matching HumanReviewRequested forces urgent_review", () => {
    const runId = "run-5";
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "low", summary: "x", recommended_next_step: "y" },
        runId
      ),
      // No HumanReviewRequested event -- simulates the safety-critical write
      // silently failing.
    ];

    const state = projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
    expect(state.status).toBe("urgent_review");
    expect(state.safetyAlert).toMatch(/SAFETY ALERT/);
  });

  it("an escalated agent failure forces urgent_review with a safety alert", () => {
    const runId = "run-6";
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
      ev(
        "AgentErrorOccurred",
        "agent",
        "triage-agent",
        { error: "LLM provider timed out", retry_count: 3, escalated: true },
        runId
      ),
    ];

    const state = projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
    expect(state.status).toBe("urgent_review");
    expect(state.safetyAlert).toMatch(/failed after retries/);
  });
});

describe("assertValidAppend (invariants)", () => {
  function stateAt(events: DomainEvent[]) {
    return projectPatientState(PATIENT_ID, DISPLAY_NAME, events);
  }

  it("rejects IntakeFormSubmitted before PatientCreated context (not intake_pending)", () => {
    const events: DomainEvent[] = [
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
    ];
    const state = stateAt(events); // status: intake_submitted
    expect(() => assertValidAppend(state, "IntakeFormSubmitted", null)).toThrow(InvariantViolationError);
  });

  it("rejects starting a triage run before intake is submitted", () => {
    const state = stateAt([ev("PatientCreated", "system", "intake-service", {})]);
    expect(() => assertValidAppend(state, "TriageAgentStarted", "run-x")).toThrow(InvariantViolationError);
  });

  it("rejects starting a second triage run while one is in progress", () => {
    const runId = "run-7";
    const state = stateAt([
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
    ]);
    expect(() => assertValidAppend(state, "TriageAgentStarted", "run-8")).toThrow(InvariantViolationError);
  });

  it("rejects a TriageToolCalled event with a run_id that doesn't match the in-progress run", () => {
    const state = stateAt([
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, "run-9"),
    ]);
    expect(() =>
      assertValidAppend(state, "TriageToolCalled", "some-other-run")
    ).toThrow(InvariantViolationError);
  });

  it("rejects a clinician decision before any triage has been reviewed", () => {
    const state = stateAt([
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
    ]);
    expect(() => assertValidAppend(state, "ClinicianDecisionRecorded", null)).toThrow(
      InvariantViolationError
    );
  });

  it("rejects scheduling a follow-up before clinician approval", () => {
    const runId = "run-10";
    const state = stateAt([
      ev("PatientCreated", "system", "intake-service", {}),
      ev("IntakeFormSubmitted", "system", "intake-service", {}),
      ev("TriageAgentStarted", "agent", "triage-agent", {}, runId),
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "low", summary: "x", recommended_next_step: "y" },
        runId
      ),
      ev("HumanReviewRequested", "agent", "triage-agent", { reason: "r" }, runId),
    ]);
    expect(() => assertValidAppend(state, "FollowUpScheduled", null)).toThrow(InvariantViolationError);
  });

  it("allows the legal happy-path sequence end to end without throwing", () => {
    const runId = "run-11";
    let events: DomainEvent[] = [];

    function apply(newEvent: DomainEvent) {
      const state = stateAt(events);
      expect(() => assertValidAppend(state, newEvent.type, newEvent.runId)).not.toThrow();
      events = [...events, newEvent];
    }

    apply(ev("PatientCreated", "system", "intake-service", {}));
    apply(ev("IntakeFormSubmitted", "system", "intake-service", {}));
    apply(ev("TriageAgentStarted", "agent", "triage-agent", {}, runId));
    apply(
      ev(
        "TriageAgentCompleted",
        "agent",
        "triage-agent",
        { riskLevel: "low", summary: "x", recommended_next_step: "y" },
        runId
      )
    );
    apply(ev("HumanReviewRequested", "agent", "triage-agent", { reason: "r" }, runId));
    apply(ev("ClinicianDecisionRecorded", "clinician", "Dr. Rivera", { decision: "approved" }));
    apply(ev("FollowUpScheduled", "system", "scheduler", { date: "2026-02-01", method: "video" }));

    expect(stateAt(events).status).toBe("follow_up_scheduled");
  });
});
