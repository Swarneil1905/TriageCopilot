import Link from "next/link";
import { ApiError, getHealth, getPatient, providerLabel } from "@/lib/api";
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
    // Best-effort: if /health is briefly unreachable, the panel just
    // renders without the "Powered by" badge rather than failing the page.
    const llmProvider = await getHealth()
      .then((h) => h.llmProvider)
      .catch(() => undefined);

    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/dashboard" className="text-sm text-teal-700 hover:underline">
          ← All patients
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-stone-900">{patient.displayName}</h1>
          <StatusBadge status={patient.status} />
          <RiskBadge riskLevel={patient.riskLevel} />
        </div>

        {patient.safetyAlert && (
          <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm font-medium text-rose-800">
            ⚠ {patient.safetyAlert}
          </div>
        )}

        {patient.lastTriageSummary && (
          <p className="mt-3 max-w-3xl text-sm text-stone-600">{patient.lastTriageSummary}</p>
        )}

        {/* Answers "what's the innovation here" directly on this page instead
            of in a document nobody opens. Three concrete, checkable claims
            about this system's architecture, not marketing language, each
            naming the exact mechanism a CTO could go read for themselves.
            A plain numbered list rather than a card grid, matching the
            landing page's own "What the architecture actually enforces"
            section: one visual language for "here is a real claim about the
            architecture" everywhere it appears on the site, instead of
            reinventing a bordered card treatment a second time. */}
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
            How this is built
          </h2>
          <div className="divide-y divide-stone-200 border-t border-stone-200">
            <div className="grid grid-cols-[2.5rem_1fr] gap-4 py-4">
              <span className="font-mono-data pt-0.5 text-sm text-stone-300">01</span>
              <div>
                <h3 className="font-semibold text-stone-900">Enforced handoff</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                  The agent cannot close out a high risk case on its own. The write path itself blocks a completion
                  event unless a human review event lands with it, in the same atomic append.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[2.5rem_1fr] gap-4 py-4">
              <span className="font-mono-data pt-0.5 text-sm text-stone-300">02</span>
              <div>
                <h3 className="font-semibold text-stone-900">One audit trail</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                  The conversation in the rail, the timeline on the left, and every event in between all render
                  from the same append only event log, so there is no separate audit system that can ever drift
                  out of sync with what actually ran.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-[2.5rem_1fr] gap-4 py-4">
              <span className="font-mono-data pt-0.5 text-sm text-stone-300">03</span>
              <div>
                <h3 className="font-semibold text-stone-900">Swappable model layer</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                  This run used {llmProvider ? providerLabel(llmProvider) : "a configured provider"}. Pointing the
                  agent at a live model is a change to one file; the safety checks and the log do not change at all.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline is the main, potentially-long column; Agent reasoning +
            What's next are stacked in a sticky rail alongside it instead of
            three equal-width columns: three equal boxes made the shorter
            two look unfinished next to however long the timeline happens to
            run. The rail staying in view while the timeline scrolls also
            mirrors a pattern most engineers already know from reviewing a
            PR (a long main thread, a persistent sidebar of status/actions). */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
          <section className="surface-flat p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
              Timeline
            </h2>
            <Timeline events={patient.events} />
          </section>

          <div className="flex flex-col gap-6 lg:sticky lg:top-6">
            <section className="surface-rail p-4">
              <h2 className="mb-3 px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Agent conversation
              </h2>
              <AgentReasoningPanel events={patient.events} llmProvider={llmProvider} />
            </section>

            <section className="surface-raised p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                What&apos;s next
              </h2>
              <p className="mb-3 text-sm text-stone-700">{patient.nextAction}</p>
              <ActionPanel patient={patient} />
            </section>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    const notFound = err instanceof ApiError && err.status === 404;
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Link href="/dashboard" className="text-sm text-teal-700 hover:underline">
          ← All patients
        </Link>
        <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {notFound
            ? "No patient found with this id."
            : "Could not reach the TriageCopilot API. Is the backend running (npm run backend:dev)?"}
        </div>
      </div>
    );
  }
}
