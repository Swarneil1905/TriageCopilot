import type { PatientStatus, RiskLevel } from "./api";

export const STATUS_LABELS: Record<PatientStatus, string> = {
  intake_pending: "Intake pending",
  intake_submitted: "Intake submitted",
  triage_in_progress: "Triage in progress",
  pending_clinician_review: "Pending clinician review",
  urgent_review: "Urgent review",
  clinician_approved: "Clinician approved",
  clinician_rejected: "Clinician rejected",
  follow_up_scheduled: "Follow-up scheduled",
};

// Tailwind class pairs (bg + text) per status. urgent_review is
// deliberately the loudest color in the set -- it's the one status where
// a clinician should not be able to miss the row.
export const STATUS_COLORS: Record<PatientStatus, string> = {
  intake_pending: "bg-gray-100 text-gray-700 ring-gray-400/40",
  intake_submitted: "bg-teal-100 text-teal-700 ring-teal-400/40",
  triage_in_progress: "bg-teal-100 text-teal-700 ring-teal-400/40",
  pending_clinician_review: "bg-amber-100 text-amber-800 ring-amber-400/40",
  urgent_review: "bg-rose-100 text-rose-800 ring-rose-500/50",
  clinician_approved: "bg-emerald-100 text-emerald-800 ring-emerald-400/40",
  clinician_rejected: "bg-orange-100 text-orange-800 ring-orange-400/40",
  follow_up_scheduled: "bg-emerald-100 text-emerald-800 ring-emerald-400/40",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low risk",
  moderate: "Moderate risk",
  high: "High risk",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  low: "bg-emerald-50 text-emerald-700 ring-emerald-300/50",
  moderate: "bg-amber-50 text-amber-700 ring-amber-300/50",
  high: "bg-rose-50 text-rose-700 ring-rose-400/50",
};

export const ACTOR_ICON: Record<string, string> = {
  system: "⚙️", // gear
  agent: "\u{1F916}", // robot
  clinician: "\u{1FA7A}", // stethoscope
};
