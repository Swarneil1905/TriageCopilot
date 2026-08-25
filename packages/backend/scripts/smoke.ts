// One-off manual smoke test against a real Postgres instance -- not part of
// the vitest suite (that stays pure/offline per SPEC.md §12). Exercises the
// real DB round trip: appendEvent's transaction + invariant check, and the
// eventStore helpers, end to end.
import { randomUUID } from "node:crypto";
import { getPool, closePool } from "../src/db.js";
import { appendEvent, createPatient, getDisplayName, getPatientState } from "../src/eventStore.js";
import { InvariantViolationError } from "../src/types.js";

async function main() {
  const pool = getPool();
  const nameOf = (id: string) => getDisplayName(pool, id);

  const { id: patientId } = await createPatient(pool, "Smoke Test Patient");
  console.log("created patient", patientId);

  await appendEvent(pool, nameOf, {
    patientId,
    type: "IntakeFormSubmitted",
    actorType: "system",
    actorName: "intake-service",
    payload: { chief_complaint: "trouble sleeping" },
  });

  const runId = randomUUID();
  await appendEvent(pool, nameOf, {
    patientId,
    runId,
    type: "TriageAgentStarted",
    actorType: "agent",
    actorName: "triage-agent",
  });

  await appendEvent(pool, nameOf, {
    patientId,
    runId,
    type: "TriageToolCalled",
    actorType: "agent",
    actorName: "triage-agent",
    payload: { tool_name: "get_patient_history", input: {}, output: { prior_triage_runs: 0 } },
  });

  await appendEvent(pool, nameOf, {
    patientId,
    runId,
    type: "TriageAgentCompleted",
    actorType: "agent",
    actorName: "triage-agent",
    payload: { riskLevel: "low", summary: "stable", recommended_next_step: "routine follow-up" },
  });

  await appendEvent(pool, nameOf, {
    patientId,
    runId,
    type: "HumanReviewRequested",
    actorType: "agent",
    actorName: "triage-agent",
    payload: { reason: "routine" },
  });

  let state = await getPatientState(pool, patientId, "Smoke Test Patient");
  console.log("state after triage + review request:", state.status, state.riskLevel);
  if (state.status !== "pending_clinician_review") {
    throw new Error(`expected pending_clinician_review, got ${state.status}`);
  }

  // Invariant check, exercised through the real DB transaction: scheduling a
  // follow-up before clinician approval must be rejected.
  let rejected = false;
  try {
    await appendEvent(pool, nameOf, {
      patientId,
      type: "FollowUpScheduled",
      actorType: "system",
      actorName: "scheduler",
      payload: { date: "2026-02-01", method: "video" },
    });
  } catch (err) {
    if (err instanceof InvariantViolationError) {
      rejected = true;
      console.log("correctly rejected premature FollowUpScheduled:", err.message);
    } else {
      throw err;
    }
  }
  if (!rejected) throw new Error("expected InvariantViolationError, none was thrown");

  await appendEvent(pool, nameOf, {
    patientId,
    type: "ClinicianDecisionRecorded",
    actorType: "clinician",
    actorName: "Dr. Rivera",
    payload: { decision: "approved", note: "agreed with agent summary", clinician_name: "Dr. Rivera" },
  });

  await appendEvent(pool, nameOf, {
    patientId,
    type: "FollowUpScheduled",
    actorType: "system",
    actorName: "scheduler",
    payload: { date: "2026-02-01", method: "video" },
  });

  state = await getPatientState(pool, patientId, "Smoke Test Patient");
  console.log("final state:", state.status);
  if (state.status !== "follow_up_scheduled") {
    throw new Error(`expected follow_up_scheduled, got ${state.status}`);
  }

  console.log(`event count: ${state.events.length}`);
  console.log("SMOKE TEST PASSED");
  await closePool();
}

main().catch(async (err) => {
  console.error("SMOKE TEST FAILED:", err);
  await closePool();
  process.exit(1);
});
