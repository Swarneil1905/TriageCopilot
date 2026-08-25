"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  runTriage,
  scheduleFollowUp,
  submitIntake,
  recordClinicianDecision,
  type PatientWorldState,
} from "@/lib/api";

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-2 text-sm text-red-600">{message}</p>;
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Working…" : children}
    </button>
  );
}

function IntakeForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await submitIntake(patientId, {
        chief_complaint: String(form.get("chief_complaint") || ""),
        phq9_score: form.get("phq9_score") ? Number(form.get("phq9_score")) : undefined,
        gad7_score: form.get("gad7_score") ? Number(form.get("gad7_score")) : undefined,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong submitting intake.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-sm">
        <span className="text-slate-700">Chief complaint</span>
        <textarea
          name="chief_complaint"
          required
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="What brought the patient in today?"
        />
      </label>
      <div className="flex gap-3">
        <label className="block text-sm">
          <span className="text-slate-700">PHQ-9</span>
          <input
            name="phq9_score"
            type="number"
            min={0}
            max={27}
            className="mt-1 block w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">GAD-7</span>
          <input
            name="gad7_score"
            type="number"
            min={0}
            max={21}
            className="mt-1 block w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <SubmitButton pending={pending}>Submit intake</SubmitButton>
      <ErrorText message={error} />
    </form>
  );
}

function RunTriageButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    try {
      await runTriage(patientId);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The triage run failed unexpectedly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Running triage agent…" : "Run triage agent"}
      </button>
      <ErrorText message={error} />
    </div>
  );
}

function ClinicianDecisionForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await recordClinicianDecision(patientId, {
        decision: String(form.get("decision")) as "approved" | "rejected" | "modified",
        note: String(form.get("note") || ""),
        clinician_name: String(form.get("clinician_name") || ""),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label className="block text-sm">
        <span className="text-slate-700">Your name</span>
        <input
          name="clinician_name"
          required
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Dr. ..."
        />
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Decision</span>
        <select
          name="decision"
          required
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="approved">Approve the agent&apos;s draft</option>
          <option value="modified">Approve with modifications</option>
          <option value="rejected">Reject -- needs re-triage</option>
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-slate-700">Note</span>
        <textarea
          name="note"
          rows={2}
          className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          placeholder="Optional clinical note"
        />
      </label>
      <SubmitButton pending={pending}>Record decision</SubmitButton>
      <ErrorText message={error} />
    </form>
  );
}

function ScheduleFollowUpForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      await scheduleFollowUp(patientId, {
        date: String(form.get("date") || ""),
        method: String(form.get("method") || ""),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not schedule the follow-up.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-3">
        <label className="block text-sm">
          <span className="text-slate-700">Date</span>
          <input
            name="date"
            type="date"
            required
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">Method</span>
          <select
            name="method"
            required
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="video">Video</option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
          </select>
        </label>
      </div>
      <SubmitButton pending={pending}>Schedule follow-up</SubmitButton>
      <ErrorText message={error} />
    </form>
  );
}

/**
 * Renders whichever action the current status actually allows -- this is
 * the UI half of the state machine's invariants. The backend rejects
 * illegal transitions regardless (see assertValidAppend), but the UI
 * shouldn't invite the clinician to try one it already knows will fail.
 */
export function ActionPanel({ patient }: { patient: PatientWorldState }) {
  switch (patient.status) {
    case "intake_pending":
      return <IntakeForm patientId={patient.patientId} />;
    case "intake_submitted":
    case "clinician_rejected":
      return <RunTriageButton patientId={patient.patientId} />;
    case "triage_in_progress":
      return <p className="text-sm text-slate-500">Triage agent is running…</p>;
    case "pending_clinician_review":
    case "urgent_review":
      return <ClinicianDecisionForm patientId={patient.patientId} />;
    case "clinician_approved":
      return <ScheduleFollowUpForm patientId={patient.patientId} />;
    case "follow_up_scheduled":
      return (
        <p className="text-sm text-slate-500">
          This care cycle is complete. Nothing further to action.
        </p>
      );
    default:
      return null;
  }
}
