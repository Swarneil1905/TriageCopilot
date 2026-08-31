import Link from "next/link";
import { getPatients, type PatientWorldState } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskBadge } from "@/components/RiskBadge";
import { NewPatientForm } from "@/components/NewPatientForm";

function lastUpdated(patient: PatientWorldState): string {
  if (patient.events.length === 0) return "None yet";
  const last = patient.events[patient.events.length - 1];
  return new Date(last.createdAt).toLocaleString();
}

export default async function PatientListPage() {
  let patients: PatientWorldState[] = [];
  let loadError: string | null = null;

  try {
    patients = await getPatients();
  } catch {
    loadError =
      "Could not reach the TriageCopilot API. Is the backend running (npm run backend:dev)?";
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">Patients</h1>
        <NewPatientForm />
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {loadError}
        </div>
      )}

      {!loadError && patients.length === 0 && (
        <p className="text-sm text-stone-500">
          No patients yet. Run <code>npm run backend:seed</code> for a set of synthetic examples,
          or create one above.
        </p>
      )}

      {!loadError && patients.length > 0 && (
        <div className="surface-flat overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Patient</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Risk</th>
                <th className="px-4 py-2">Last updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {patients.map((patient) => (
                <tr key={patient.patientId} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/patients/${patient.patientId}`}
                      className="font-medium text-teal-700 hover:underline"
                    >
                      {patient.displayName}
                    </Link>
                    {patient.safetyAlert && (
                      <div className="mt-0.5 text-xs font-medium text-rose-600">⚠ Safety alert</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={patient.status} />
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge riskLevel={patient.riskLevel} />
                  </td>
                  <td className="font-mono-data px-4 py-3 text-xs text-stone-500">{lastUpdated(patient)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
