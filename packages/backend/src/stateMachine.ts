import {
  DomainEvent,
  EventType,
  InvariantViolationError,
  PatientStatus,
  PatientWorldState,
  RiskLevel,
} from "./types.js";

/**
 * Pure projection: fold an ordered event stream into the patient's current
 * world-state. No I/O, no side effects: this is the "world-state &
 * simulation" primitive from the JD. Replaying the same events always
 * produces the same state, and you can replay a prefix of the stream to see
 * what the state looked like at any point in the past (useful for audits:
 * "what did the dashboard show the clinician at 2:14pm?").
 *
 * Defense-in-depth note: if a TriageAgentCompleted event is ever found
 * without a matching HumanReviewRequested for the same run, we do NOT let
 * the patient silently look "fine." We force status into urgent_review with
 * a safetyAlert explaining why. In a real system this should never happen
 * (the orchestrator writes both events atomically), but the projector
 * treats "safety-critical event missing" as a hard stop rather than trusting
 * that upstream code always behaves.
 */
export function projectPatientState(
  patientId: string,
  displayName: string,
  events: DomainEvent[]
): PatientWorldState {
  let status: PatientStatus = "intake_pending";
  let riskLevel: RiskLevel | null = null;
  let lastTriageSummary: string | null = null;
  let pendingRunId: string | null = null;
  let completedRunAwaitingReview: string | null = null;
  let safetyAlert: string | null = null;

  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  for (const ev of sorted) {
    switch (ev.type) {
      case "PatientCreated":
        status = "intake_pending";
        break;

      case "IntakeFormSubmitted":
        status = "intake_submitted";
        break;

      case "TriageAgentStarted":
        status = "triage_in_progress";
        pendingRunId = ev.runId;
        safetyAlert = null;
        break;

      case "TriageToolCalled":
        // No status change: these are recorded purely for the "agent
        // reasoning" trace shown in the ops UI (what tools it called, why).
        break;

      case "TriageAgentCompleted": {
        const p = ev.payload as {
          riskLevel: RiskLevel;
          summary: string;
        };
        riskLevel = p.riskLevel;
        lastTriageSummary = p.summary;
        completedRunAwaitingReview = ev.runId;
        break;
      }

      case "HumanReviewRequested":
        if (ev.runId && ev.runId === completedRunAwaitingReview) {
          completedRunAwaitingReview = null;
          pendingRunId = null;
          status = riskLevel === "high" ? "urgent_review" : "pending_clinician_review";
        }
        break;

      case "ClinicianDecisionRecorded": {
        const p = ev.payload as { decision: "approved" | "rejected" };
        status = p.decision === "approved" ? "clinician_approved" : "clinician_rejected";
        break;
      }

      case "FollowUpScheduled":
        status = "follow_up_scheduled";
        break;

      case "AgentErrorOccurred": {
        const p = ev.payload as { escalated?: boolean; error?: string };
        if (p.escalated) {
          status = "urgent_review";
          safetyAlert = `Triage agent failed after retries: ${p.error ?? "unknown error"}. Needs manual triage.`;
          pendingRunId = null;
        }
        break;
      }
    }
  }

  // The defense-in-depth catch described above.
  if (completedRunAwaitingReview) {
    status = "urgent_review";
    safetyAlert =
      "SAFETY ALERT: triage completed but no human-review request was ever logged for this run. " +
      "Do not treat this patient as reviewed. Escalate to engineering before proceeding.";
  }

  return {
    patientId,
    displayName,
    status,
    riskLevel,
    lastTriageSummary,
    nextAction: describeNextAction(status, safetyAlert),
    pendingRunId,
    safetyAlert,
    events: sorted,
  };
}

function describeNextAction(status: PatientStatus, safetyAlert: string | null): string {
  if (safetyAlert) return safetyAlert;
  switch (status) {
    case "intake_pending":
      return "Waiting on patient to submit intake form.";
    case "intake_submitted":
      return "Ready to run the triage agent.";
    case "triage_in_progress":
      return "Triage agent is running.";
    case "pending_clinician_review":
      return "Awaiting clinician review of the agent's triage summary.";
    case "urgent_review":
      return "URGENT: risk flagged high. Needs immediate clinician attention.";
    case "clinician_approved":
      return "Ready to schedule follow-up.";
    case "clinician_rejected":
      return "Clinician rejected the triage. Needs re-triage or manual intake.";
    case "follow_up_scheduled":
      return "Journey complete for this cycle; follow-up is on the books.";
  }
}

/**
 * Invariant gate: called before every event append. This is the code-level
 * expression of "we think in events, state, and invariants, not just CRUD
 * endpoints": illegal transitions are rejected at the write path, not
 * just hidden in the UI.
 */
export function assertValidAppend(
  currentState: PatientWorldState,
  newEventType: EventType,
  newRunId: string | null
): void {
  const { status, pendingRunId } = currentState;

  switch (newEventType) {
    case "PatientCreated":
      if (currentState.events.length > 0) {
        throw new InvariantViolationError("PatientCreated may only be the first event.");
      }
      break;

    case "IntakeFormSubmitted":
      if (status !== "intake_pending") {
        throw new InvariantViolationError(
          `Cannot submit intake form from status "${status}".`
        );
      }
      break;

    case "TriageAgentStarted":
      if (!["intake_submitted", "clinician_rejected"].includes(status)) {
        throw new InvariantViolationError(
          `Cannot start triage from status "${status}": intake must be submitted first (or a prior triage rejected).`
        );
      }
      if (pendingRunId) {
        throw new InvariantViolationError(
          "A triage run is already in progress for this patient."
        );
      }
      break;

    case "TriageToolCalled":
    case "TriageAgentCompleted":
    case "AgentErrorOccurred":
      if (status !== "triage_in_progress") {
        throw new InvariantViolationError(
          `Cannot record agent activity from status "${status}": no triage run is in progress.`
        );
      }
      if (!newRunId || newRunId !== pendingRunId) {
        throw new InvariantViolationError(
          "Event run_id does not match the in-progress triage run."
        );
      }
      break;

    case "HumanReviewRequested":
      // Allowed any time a run has completed; the projector reconciles it.
      break;

    case "ClinicianDecisionRecorded":
      if (!["pending_clinician_review", "urgent_review"].includes(status)) {
        throw new InvariantViolationError(
          `Cannot record a clinician decision from status "${status}": ` +
            "the human-in-the-loop gate requires a completed, reviewed triage first."
        );
      }
      break;

    case "FollowUpScheduled":
      if (status !== "clinician_approved") {
        throw new InvariantViolationError(
          `Cannot schedule follow-up from status "${status}": requires clinician approval first.`
        );
      }
      break;
  }
}
