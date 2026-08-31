import Link from "next/link";
import { getHealth, getPatients } from "@/lib/api";
import { AgentReasoningPanel } from "@/components/AgentReasoningPanel";
import { LiveDemoRunner } from "@/components/LiveDemoRunner";

const PRINCIPLES = [
  {
    title: "Events are the only source of truth",
    body:
      "Every status, risk level, and clinician note is a pure fold over an append-only event log, not a mutable row. Replay the log to any timestamp and you get an exact reconstruction of what the system believed at that moment.",
  },
  {
    title: "The agent can't finalize anything, structurally",
    body:
      "The triage agent is asked, in its system prompt, to always hand off to a clinician. It doesn't matter whether it complies: the orchestrator writes the completion + human-review-requested events itself, every run, regardless of what the model did. Prompted safety is a suggestion; this is a guarantee.",
  },
  {
    title: "Failure escalates instead of disappearing",
    body:
      "A flaky LLM call retries with backoff and logs every attempt. If it never recovers, the patient is forced into urgent_review rather than silently left in limbo -- and a defense-in-depth check catches the rarer case where the safety event itself somehow failed to write.",
  },
  {
    title: "Bring your own model",
    body:
      "The agent talks to an LLMProvider interface, not a vendor SDK. Ship with zero setup on a deterministic fake, point it at Anthropic for a hosted model, or run it entirely against a local Ollama model with nothing leaving your machine.",
  },
] as const;

export default async function LandingPage() {
  let patientCount: number | null = null;
  let featuredEvents: Awaited<ReturnType<typeof getPatients>>[number]["events"] | null = null;
  let featuredPatientId: string | null = null;
  try {
    const patients = await getPatients();
    patientCount = patients.length;
    // The first patient with an actual completed triage run, so the landing
    // page shows a real trace rather than a mockup -- read-only, no cost,
    // no auth required. Falls back gracefully to "no run yet" right after a
    // fresh seed reset with nothing completed.
    const featured = patients.find((p) => p.events.some((e) => e.type === "TriageToolCalled"));
    if (featured) {
      featuredEvents = featured.events;
      featuredPatientId = featured.patientId;
    }
  } catch {
    patientCount = null;
  }
  const llmProvider = await getHealth()
    .then((h) => h.llmProvider)
    .catch(() => undefined);

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-teal-700">
            A synthetic care-ops prototype
          </p>
          <h1 className="font-display text-4xl font-semibold leading-tight text-stone-900 sm:text-5xl">
            An AI triage agent that is architecturally incapable of finalizing a decision.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-stone-600">
            TriageCopilot works a synthetic patient&apos;s intake end to end, tool call by tool
            call, then hands every single case to a human clinician. Not because the prompt
            asks nicely -- because the orchestrator enforces it.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-md bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-600"
            >
              View the live dashboard
            </Link>
            <Link
              href="/how-it-works"
              className="rounded-md border border-stone-300 px-5 py-2.5 text-sm font-semibold text-stone-800 hover:bg-stone-50"
            >
              See how it works
            </Link>
          </div>
          {patientCount !== null && (
            <p className="mt-6 text-xs text-stone-400">
              {patientCount} synthetic patient{patientCount === 1 ? "" : "s"} currently on the
              dashboard, live from this instance&apos;s own database.
            </p>
          )}
        </div>
      </section>

      {/* Watch the AI agent reason */}
      <section className="border-b border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-display text-center text-2xl font-semibold text-stone-900">
            Watch the AI agent reason
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-relaxed text-stone-600">
            This is the actual tool-by-tool trace the triage agent produces on a real intake -- not a mockup, not a
            screenshot. Every line below is a logged <code>TriageToolCalled</code> event.
          </p>

          <div className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
            {featuredEvents ? (
              <>
                <AgentReasoningPanel events={featuredEvents} llmProvider={llmProvider} />
                {featuredPatientId && (
                  <Link
                    href={`/patients/${featuredPatientId}`}
                    className="mt-4 inline-block text-sm font-semibold text-teal-700 hover:underline"
                  >
                    View this patient&apos;s full page →
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm text-stone-500">
                No completed triage run yet on this instance -- run the seed script or use the button below to
                produce one.
              </p>
            )}
          </div>

          <div className="mt-6">
            <LiveDemoRunner />
          </div>
        </div>
      </section>

      {/* What this is / isn't */}
      <section className="mx-auto max-w-4xl px-6 py-12 text-center">
        <p className="text-sm text-stone-600">
          <strong className="font-semibold text-stone-800">
            Synthetic demo data only, by design.
          </strong>{" "}
          No real patients, no real PHI, no real diagnoses or prescribing logic. This is a
          portfolio prototype built to demonstrate architecture -- event sourcing, invariant
          enforcement, agent tool-calling, and a hard human-in-the-loop gate -- the same
          primitives a real clinical ops platform is built from, at a scale honest about what it
          is.
        </p>
      </section>

      {/* Core design principles */}
      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="font-display text-center text-2xl font-semibold text-stone-900">
            What the architecture actually enforces
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {PRINCIPLES.map((p) => (
              <div key={p.title} className="rounded-lg border border-stone-200 p-5">
                <h3 className="font-semibold text-stone-900">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product-notes teaser */}
      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h2 className="font-display text-2xl font-semibold text-stone-900">
          Built after looking closely at what real triage products are missing
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-stone-600">
          Before writing any of this, I read through how AI-native clinical-ops products
          actually talk about safety, audit trails, and human-in-the-loop review in practice --
          and where the gaps still are. Product notes lays out specifically what I noticed and
          how each piece of TriageCopilot answers it.
        </p>
        <Link
          href="/product-notes"
          className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline"
        >
          Read the product notes →
        </Link>
      </section>
    </div>
  );
}
