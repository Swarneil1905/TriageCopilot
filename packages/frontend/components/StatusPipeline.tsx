import type { PatientStatus } from "@/lib/api";
import { STATUS_LABELS } from "@/lib/statusMeta";

// The ordered "trunk" of the patient journey the state machine actually
// walks on its normal path (see stateMachine.ts's projectPatientState):
// PatientCreated -> IntakeFormSubmitted -> TriageAgentStarted ->
// HumanReviewRequested -> ClinicianDecisionRecorded(approved) ->
// FollowUpScheduled. pending_clinician_review and urgent_review are the
// same trunk position: both come from that one HumanReviewRequested event,
// the only difference being the risk level the agent flagged. That is why
// urgent_review is rendered as a branch below the trunk rather than a
// seventh straight-line step: turning it into another box on the same row
// would claim a linearity the state machine itself doesn't have.
// clinician_rejected is the other branch off the same review point: a
// clinician can bounce a case back for re-triage instead of approving it.
const TRUNK: ReadonlyArray<{ status: PatientStatus; label: string }> = [
  { status: "intake_pending", label: STATUS_LABELS.intake_pending },
  { status: "intake_submitted", label: STATUS_LABELS.intake_submitted },
  { status: "triage_in_progress", label: STATUS_LABELS.triage_in_progress },
  { status: "pending_clinician_review", label: "Clinician review" },
  { status: "clinician_approved", label: STATUS_LABELS.clinician_approved },
  { status: "follow_up_scheduled", label: STATUS_LABELS.follow_up_scheduled },
];

const REVIEW_INDEX = 3;

function trunkIndex(status: PatientStatus): number {
  switch (status) {
    case "intake_pending":
      return 0;
    case "intake_submitted":
      return 1;
    case "triage_in_progress":
      return 2;
    case "pending_clinician_review":
    case "urgent_review":
    case "clinician_rejected":
      return REVIEW_INDEX;
    case "clinician_approved":
      return 4;
    case "follow_up_scheduled":
      return 5;
  }
}

const BRANCH_META: Record<"urgent_review" | "clinician_rejected", { label: string; ring: string; dot: string; text: string }> = {
  urgent_review: {
    label: "Urgent review",
    ring: "ring-rose-300",
    dot: "bg-rose-600",
    text: "text-rose-700",
  },
  clinician_rejected: {
    label: "Rejected: needs re-triage",
    ring: "ring-orange-300",
    dot: "bg-orange-500",
    text: "text-orange-700",
  },
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Renders the patient status state machine as a real horizontal stepper
 * (see the Documenso-style pattern this pass is modeled on) instead of just
 * a single colored badge: past steps checked off, the current step
 * highlighted, and the two non-linear outcomes (urgent_review,
 * clinician_rejected) drawn as a distinct branch under the review step
 * rather than forced onto the trunk. `size="sm"` is a compact strip for a
 * dashboard row (dots only, labels as title tooltips); `size="lg"` is the
 * full labeled version for the patient detail header.
 */
export function StatusPipeline({ status, size = "lg" }: { status: PatientStatus; size?: "sm" | "lg" }) {
  const current = trunkIndex(status);
  const branchKey = status === "urgent_review" || status === "clinician_rejected" ? status : null;
  const branch = branchKey ? BRANCH_META[branchKey] : null;
  const compact = size === "sm";
  const branchLeftPct = (REVIEW_INDEX / (TRUNK.length - 1)) * 100;

  return (
    <div className={compact ? "w-full max-w-[220px]" : "w-full max-w-2xl"}>
      <ol className="flex items-center">
        {TRUNK.map((step, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const detoured = isCurrent && branch;

          return (
            <li key={step.status} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  title={step.label}
                  aria-current={isCurrent && !detoured ? "step" : undefined}
                  className={
                    "flex shrink-0 items-center justify-center rounded-full font-semibold transition-colors " +
                    (compact ? "h-4 w-4 text-[0px]" : "h-7 w-7 text-[11px]") +
                    " " +
                    (done || detoured
                      ? "bg-stone-800 text-white"
                      : isCurrent
                        ? "bg-white text-teal-700 ring-2 ring-teal-600"
                        : "bg-white text-stone-400 ring-1 ring-inset ring-stone-300")
                  }
                >
                  {done || detoured ? <CheckIcon /> : compact ? null : i + 1}
                </span>
                {!compact && (
                  <span
                    className={
                      "mt-1.5 max-w-[5.5rem] text-center text-[11px] leading-tight " +
                      (isCurrent && !detoured ? "font-semibold text-stone-900" : "text-stone-500")
                    }
                  >
                    {step.label}
                  </span>
                )}
              </div>
              {i < TRUNK.length - 1 && (
                <span
                  className={
                    "mx-1 h-px flex-1 " + (i < current ? "bg-stone-800" : "bg-stone-200") + (compact ? "" : " mb-5")
                  }
                />
              )}
            </li>
          );
        })}
      </ol>

      {branch && (
        <div className="relative" style={{ height: compact ? 22 : 34 }}>
          <div
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: `${branchLeftPct}%` }}
          >
            <span className={"h-2.5 w-px " + (branchKey === "urgent_review" ? "bg-rose-300" : "bg-orange-300")} />
            <span
              className={
                "flex items-center gap-1 rounded-full ring-1 " +
                (compact ? "px-1.5 py-0 text-[10px]" : "px-2.5 py-1 text-xs font-medium") +
                " " +
                branch.ring +
                " " +
                branch.text +
                " bg-white"
              }
            >
              <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + branch.dot} />
              <span className="whitespace-nowrap">{branch.label}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
