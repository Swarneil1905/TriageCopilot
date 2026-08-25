// Shared domain types, copy-pasted from packages/backend/src/types.ts by
// design (see the comment there) -- kept dependency-free so the frontend
// never needs to import backend code, just agree on the wire shape.

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

export interface ApiErrorBody {
  error: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.details = body.details;
  }
}

// NEXT_PUBLIC_-prefixed so the same value is available in both Server
// Components (fetched at request time on the server) and Client Components
// (forms/buttons calling the API directly from the browser). Defaults to
// the backend's default local port from .env.example.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type when there's actually a JSON body -- Fastify's
  // default body parser rejects an empty body when this header is present
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which is exactly what a no-payload POST
  // like /run-triage sends.
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  if (!res.ok) {
    let body: ApiErrorBody;
    try {
      body = await res.json();
    } catch {
      body = { error: `Request failed with status ${res.status}` };
    }
    throw new ApiError(res.status, body);
  }

  return res.json() as Promise<T>;
}

export function getPatients(): Promise<PatientWorldState[]> {
  return request<PatientWorldState[]>("/patients");
}

export function getPatient(id: string): Promise<PatientWorldState> {
  return request<PatientWorldState>(`/patients/${id}`);
}

export function getAuditLog(id: string): Promise<{ patientId: string; events: DomainEvent[] }> {
  return request(`/patients/${id}/audit-log`);
}

export function createPatient(displayName: string): Promise<PatientWorldState> {
  return request<PatientWorldState>("/patients", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName }),
  });
}

export function submitIntake(
  id: string,
  payload: { chief_complaint: string; phq9_score?: number; gad7_score?: number; free_text?: string }
): Promise<PatientWorldState> {
  return request<PatientWorldState>(`/patients/${id}/intake`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runTriage(id: string): Promise<PatientWorldState> {
  return request<PatientWorldState>(`/patients/${id}/run-triage`, { method: "POST" });
}

export function recordClinicianDecision(
  id: string,
  payload: { decision: "approved" | "rejected" | "modified"; note?: string; clinician_name: string }
): Promise<PatientWorldState> {
  return request<PatientWorldState>(`/patients/${id}/clinician-decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function scheduleFollowUp(
  id: string,
  payload: { date: string; method: string }
): Promise<PatientWorldState> {
  return request<PatientWorldState>(`/patients/${id}/schedule-follow-up`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
