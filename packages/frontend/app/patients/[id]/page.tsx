import Link from "next/link";
import { ApiError, getPatient } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskBadge } from "@/components/RiskBadge";
import { Timeline } from "@/components/Timeline";
import { AgentReasoningPanel } from "@/components/AgentReasoningPanel";
import { ActionPanel } from "@/components/ActionPanel";

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const patient = await getPatient(id);

    return (
      <div>
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ← All patients
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{patient.displayName}</h1>
          <StatusBadge status={patient.status} />
          <RiskBadge riskLevel={patient.riskLevel} />
        </div>

        {patient.safetyAlert && (
          <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-800">
            ⚠ {patient.safetyAlert}
          </div>
        )}

        {patient.lastTriageSummary && (
          <p className="mt-3 max-w-3xl text-sm text-slate-600">{patient.lastTriageSummary}</p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Timeline
            </h2>
            <Timeline events={patient.events} />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Agent reasoning
            </h2>
            <AgentReasoningPanel events={patient.events} />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              What&apos;s next
            </h2>
            <p className="mb-3 text-sm text-slate-700">{patient.nextAction}</p>
            <ActionPanel patient={patient} />
          </section>
        </div>
      </div>
    );
  } catch (err) {
    const notFound = err instanceof ApiError && err.status === 404;
    return (
      <div>
        <Link href="/" className="text-sm text-blue-700 hover:underline">
          ← All patients
        </Link>
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {notFound
            ? "No patient found with this id."
            : "Could not reach the TriageCopilot API. Is the backend running (npm run backend:dev)?"}
        </div>
      </div>
    );
  }
}
