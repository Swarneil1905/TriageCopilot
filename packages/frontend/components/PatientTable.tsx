"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PatientStatus, PatientWorldState, RiskLevel } from "@/lib/api";
import { RISK_LABELS, STATUS_LABELS } from "@/lib/statusMeta";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskBadge } from "@/components/RiskBadge";
import { StatusPipeline } from "@/components/StatusPipeline";
import { NewPatientForm } from "@/components/NewPatientForm";
import { Input } from "@/components/ui/Input";

function lastUpdatedMs(patient: PatientWorldState): number {
  if (patient.events.length === 0) return 0;
  return new Date(patient.events[patient.events.length - 1].createdAt).getTime();
}

function lastUpdatedLabel(patient: PatientWorldState): string {
  if (patient.events.length === 0) return "None yet";
  return new Date(lastUpdatedMs(patient)).toLocaleString();
}

/** The small filled sparkle mark used elsewhere as the agent's own avatar
 * (see AgentReasoningPanel), reused here rather than a second one-off icon:
 * one consistent "this app's own mark," not a new visual idea just for an
 * empty state. */
function SparkleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
    </svg>
  );
}

function SortArrow({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className={"h-3 w-3 transition-transform " + (direction === "asc" ? "rotate-180" : "")}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors " +
        (active
          ? "bg-stone-900 text-white ring-stone-900"
          : "bg-white text-stone-600 ring-stone-300 hover:bg-stone-50")
      }
    >
      {children}
    </button>
  );
}

const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as PatientStatus[];
const RISK_OPTIONS = Object.keys(RISK_LABELS) as RiskLevel[];

/**
 * The interactive half of the dashboard: search, status/risk filters, and a
 * sortable "Last updated" column, all client-side over an already-fetched
 * list (the seeded dataset is small enough that a server round trip per
 * keystroke would be pure overhead, not a scaling need). The initial fetch
 * and its loading/error states still live in the server component
 * (app/dashboard/page.tsx, app/dashboard/loading.tsx); this component only
 * ever receives a list that already loaded successfully.
 */
export function PatientTable({
  patients,
  autoOpenNewForm = false,
}: {
  patients: PatientWorldState[];
  autoOpenNewForm?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PatientStatus | null>(null);
  const [riskFilter, setRiskFilter] = useState<RiskLevel | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return patients
      .filter((p) => (term ? p.displayName.toLowerCase().includes(term) : true))
      .filter((p) => (statusFilter ? p.status === statusFilter : true))
      .filter((p) => (riskFilter ? p.riskLevel === riskFilter : true))
      .sort((a, b) => (sortDir === "asc" ? lastUpdatedMs(a) - lastUpdatedMs(b) : lastUpdatedMs(b) - lastUpdatedMs(a)));
  }, [patients, search, statusFilter, riskFilter, sortDir]);

  const hasAnyPatients = patients.length > 0;
  const filtersActive = Boolean(search || statusFilter || riskFilter);

  if (!hasAnyPatients) {
    return (
      <div className="surface-flat flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <SparkleIcon className="h-5 w-5" />
        </span>
        <p className="max-w-sm text-sm text-stone-500">
          No patients yet. Run <code>npm run backend:seed</code> for a set of synthetic examples, or
          create one below.
        </p>
        <div className="mt-1">
          <NewPatientForm autoOpen={autoOpenNewForm} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search patients by name"
          className="max-w-xs"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={statusFilter === null} onClick={() => setStatusFilter(null)}>
            All statuses
          </FilterChip>
          {STATUS_OPTIONS.map((s) => (
            <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}>
              {STATUS_LABELS[s]}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={riskFilter === null} onClick={() => setRiskFilter(null)}>
            All risk
          </FilterChip>
          {RISK_OPTIONS.map((r) => (
            <FilterChip key={r} active={riskFilter === r} onClick={() => setRiskFilter(riskFilter === r ? null : r)}>
              {RISK_LABELS[r]}
            </FilterChip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="surface-flat flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm text-stone-500">No patients match the current search and filters.</p>
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setStatusFilter(null);
              setRiskFilter(null);
            }}
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            Clear search and filters
          </button>
        </div>
      ) : (
        <div className="surface-flat overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200 text-sm">
            <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Patient</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Risk</th>
                <th className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                    className="flex items-center gap-1 uppercase tracking-wide text-stone-500 hover:text-stone-800"
                  >
                    Last updated
                    <SortArrow direction={sortDir} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtered.map((patient) => (
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
                    <div className="flex flex-col gap-1.5">
                      <StatusBadge status={patient.status} />
                      <StatusPipeline status={patient.status} size="sm" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <RiskBadge riskLevel={patient.riskLevel} />
                  </td>
                  <td className="font-mono-data px-4 py-3 text-xs text-stone-500">{lastUpdatedLabel(patient)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtersActive && filtered.length > 0 && (
        <p className="mt-2 text-xs text-stone-400">
          Showing {filtered.length} of {patients.length} patients.
        </p>
      )}
    </div>
  );
}
