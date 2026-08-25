// Shared domain types. Kept dependency-free so they can be copy-pasted into
// the frontend's lib/api.ts without pulling in backend code.

export type ActorType = "system" | "agent" | "clinician";

export type EventType =
  | "PatientCreated"
  | "IntakeFormSubmitted"
  | "TriageAgentStarted"
  | "TriageToolCalled"
  | "TriageAgentCompleted"
  | "HumanReviewRequested"
  | "ClinicianDecisionRecorded"
  | "FollowUpScheduled"
  | "AgentErrorOccurred";

export interface DomainEvent<P = Record<string, unknown>> {
  id: string;
  patientId: string;
  runId: string | null;
  type: EventType;
  actorType: ActorType;
  actorName: string;
  payload: P;
  createdAt: string;
}

export type RiskLevel = "low" | "moderate" | "high";

export type PatientStatus =
  | "intake_pending"
  | "intake_submitted"
  | "triage_in_progress"
  | "pending_clinician_review"
  | "urgent_review"
  | "clinician_approved"
  | "clinician_rejected"
  | "follow_up_scheduled";

export interface PatientWorldState {
  patientId: string;
  displayName: string;
  status: PatientStatus;
  riskLevel: RiskLevel | null;
  lastTriageSummary: string | null;
  nextAction: string;
  pendingRunId: string | null;
  safetyAlert: string | null;
  events: DomainEvent[];
}

export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

export class PatientNotFoundError extends Error {
  constructor(patientId: string) {
    super(`Patient ${patientId} not found`);
    this.name = "PatientNotFoundError";
  }
}
