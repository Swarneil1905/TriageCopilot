"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createPatient } from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { FieldError } from "@/components/ui/FieldError";

export function NewPatientForm({ autoOpen = false }: { autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const displayName = String(form.get("display_name") || "").trim();
    try {
      const patient = await createPatient(displayName);
      router.push(`/patients/${patient.patientId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the patient.");
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
      >
        + New synthetic patient
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2">
      <Input
        name="display_name"
        required
        autoFocus
        placeholder="e.g. Taylor Nguyen (synthetic)"
        className="w-auto"
        invalid={Boolean(error)}
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-md px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700"
      >
        Cancel
      </button>
      {error && <FieldError message={error} />}
    </form>
  );
}
