import { getPatients, type PatientWorldState } from "@/lib/api";
import { NewPatientForm } from "@/components/NewPatientForm";
import { PatientTable } from "@/components/PatientTable";

export default async function PatientListPage({
  searchParams,
}: {
  // The command palette's "+ New synthetic patient" action links here with
  // ?new=1 so the form is already open on arrival, instead of landing on
  // the dashboard and making the visitor click the button a second time.
  searchParams: Promise<{ new?: string }>;
}) {
  let patients: PatientWorldState[] = [];
  let loadError: string | null = null;

  try {
    patients = await getPatients();
  } catch {
    loadError =
      "Could not reach the TriageCopilot API. Is the backend running (npm run backend:dev)?";
  }
  const { new: autoOpenParam } = await searchParams;
  const autoOpen = autoOpenParam === "1";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">Patients</h1>
        {patients.length > 0 && <NewPatientForm autoOpen={autoOpen} />}
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {!loadError && <PatientTable patients={patients} autoOpenNewForm={autoOpen} />}
    </div>
  );
}
