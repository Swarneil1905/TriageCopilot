"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  runTriage,
  scheduleFollowUp,
  submitIntake,
  recordClinicianDecision,
  type PatientWorldState,
} from "@/lib/api";
import { useSession } from "@/components/SessionProvider";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { FieldError } from "@/components/ui/FieldError";

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
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
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="chief_complaint">Chief complaint</Label>
        <Textarea
          id="chief_complaint"
          name="chief_complaint"
          required
          rows={2}
          className="mt-1"
          placeholder="What brought the patient in today?"
        />
      </div>
      <div className="flex gap-3">
        <div>
          <Label htmlFor="phq9_score">PHQ-9</Label>
          <Input id="phq9_score" name="phq9_score" type="number" min={0} max={27} className="mt-1 w-20" />
        </div>
        <div>
          <Label htmlFor="gad7_score">GAD-7</Label>
          <Input id="gad7_score" name="gad7_score" type="number" min={0} max={21} className="mt-1 w-20" />
        </div>
      </div>
      <SubmitButton pending={pending}>Submit intake</SubmitButton>
      <FieldError message={error} />
    </form>
  );
}

function RunTriageButton({ patientId }: { patientId: string }) {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  async function onClick() {
    setPending(true);
    setError(null);
    setQuotaExhausted(false);
    try {
      await runTriage(patientId);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setError(err.message);
        setQuotaExhausted(true);
      } else if (err instanceof ApiError && err.status === 401) {
        // The session most likely expired mid-page; refresh() isn't called
        // here on purpose (a full reload is the simplest way to get the
        // logged-out state everywhere else on the page, not just this
        // button, back in sync).
        setError("Your session has expired. Please log in again.");
      } else {
        setError(err instanceof ApiError ? err.message : "The triage run failed unexpectedly.");
      }
    } finally {
      setPending(false);
    }
  }

  // This route never required a login before this pass added a real
  // free-tier quota to it (see routes/patients.ts and the auth-billing
  // prompt's own scope-change callout): triggering a real agent run is now
  // the one action here that costs real money, so it's the one action here
  // that needs to know who's asking. Patient data itself (this whole page,
  // the audit log) stays exactly as open as it's always been.
  if (!sessionLoading && !user) {
    return (
      <div>
        <p className="mb-2 text-sm text-stone-600">Running the triage agent now requires an account.</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/patients/${patientId}`)}`}
          className="inline-block rounded-md border border-teal-700 px-3 py-1.5 text-sm font-semibold text-teal-800 hover:bg-teal-50"
        >
          Log in to run the agent
        </Link>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending || sessionLoading}
        className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Running triage agent…" : "Run triage agent"}
      </button>
      <FieldError message={error} />
      {quotaExhausted && (
        <p className="mt-2 text-sm text-stone-600">
          <Link href="/billing" className="font-semibold text-teal-700 hover:underline">
            Subscribe for unlimited runs →
          </Link>
        </p>
      )}
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
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="clinician_name">Your name</Label>
        <Input id="clinician_name" name="clinician_name" required className="mt-1" placeholder="Dr. ..." />
      </div>
      <div>
        <Label htmlFor="decision">Decision</Label>
        <Select id="decision" name="decision" required className="mt-1">
          <option value="approved">Approve the agent&apos;s draft</option>
          <option value="modified">Approve with modifications</option>
          <option value="rejected">Reject: needs re-triage</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" name="note" rows={2} className="mt-1" placeholder="Optional clinical note" />
      </div>
      <SubmitButton pending={pending}>Record decision</SubmitButton>
      <FieldError message={error} />
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
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex gap-3">
        <div>
          <Label htmlFor="date">Date</Label>
          <Input id="date" name="date" type="date" required className="mt-1 w-auto" />
        </div>
        <div>
          <Label htmlFor="method">Method</Label>
          <Select id="method" name="method" required className="mt-1 w-auto">
            <option value="video">Video</option>
            <option value="phone">Phone</option>
            <option value="in_person">In person</option>
          </Select>
        </div>
      </div>
      <SubmitButton pending={pending}>Schedule follow-up</SubmitButton>
      <FieldError message={error} />
    </form>
  );
}

/**
 * Renders whichever action the current status actually allows. This is
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
      return <p className="text-sm text-stone-500">Triage agent is running…</p>;
    case "pending_clinician_review":
    case "urgent_review":
      return <ClinicianDecisionForm patientId={patient.patientId} />;
    case "clinician_approved":
      return <ScheduleFollowUpForm patientId={patient.patientId} />;
    case "follow_up_scheduled":
      return (
        <p className="text-sm text-stone-500">
          This care cycle is complete. Nothing further to action.
        </p>
      );
    default:
      return null;
  }
}
