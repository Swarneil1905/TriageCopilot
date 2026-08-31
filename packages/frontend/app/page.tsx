import Link from "next/link";
import { getHealth, getPatients } from "@/lib/api";
import { AgentReasoningPanel } from "@/components/AgentReasoningPanel";
import { LiveDemoRunner } from "@/components/LiveDemoRunner";
import { Reveal } from "@/components/Reveal";

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
      "A flaky LLM call retries with backoff and logs every attempt. If it never recovers, the patient is forced into urgent_review rather than silently left in limbo. A defense-in-depth check separately catches the rarer case where the safety event itself somehow failed to write.",
  },
  {
    title: "Bring your own model",
    body:
      "The agent talks to an LLMProvider interface, not a vendor SDK. Ship with zero setup on a deterministic fake, point it at Anthropic for a hosted model, or run it entirely against a local Ollama model with nothing leaving your machine.",
  },
] as const;

// Real, checkable numbers pulled from this codebase, not a marketing
// metrics row. Each one is something a visitor could go verify for
// themselves in the repo: the event union in types.ts, the state machine's
// status union, the backend test suite CI actually runs, and the single
// transactional write path the orchestrator uses to close a run. No
// business metric here is invented, because none exist yet: this is a
// solo prototype, not a company with a customer base to cite.
const STATS = [
  { value: "9", label: "event types in the append-only log" },
  { value: "8", label: "patient statuses the state machine can reach" },
  { value: "51", label: "backend tests, run against a real Postgres in CI" },
  { value: "1", label: "transactional path writes every run's completion" },
] as const;

export default async function LandingPage() {
  let patientCount: number | null = null;
  let featuredEvents: Awaited<ReturnType<typeof getPatients>>[number]["events"] | null = null;
  let featuredPatientId: string | null = null;
  try {
    const patients = await getPatients();
    patientCount = patients.length;
    // The first patient with an actual completed triage run, so the landing
    // page shows a real trace rather than a mockup (read-only, no cost,
    // no auth required). Falls back gracefully to "no run yet" right after a
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
      {/* Hero. A single dark panel on an otherwise plain page, matching
          Abridge's actual hero, which is one big black panel holding only
          an eyebrow, a headline, subtext, and two buttons: no side by side
          split, no box of data crammed in next to the copy. The real
          product itself is shown immediately below, in its own section,
          as an actual screenshot rather than squeezed into the hero. */}
      <section className="border-b border-stone-200">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24">
          <div className="surface-hero-dark px-6 py-16 sm:px-14 sm:py-20 lg:px-20 lg:py-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-teal-300">
              <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
              A synthetic care-ops prototype
            </span>
            <h1 className="font-display mt-7 max-w-3xl text-4xl font-semibold leading-[1.03] text-white sm:text-6xl lg:text-7xl">
              An AI triage agent that is{" "}
              <span className="text-teal-300">architecturally incapable</span> of finalizing a
              decision.
            </h1>
            <p className="mt-7 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
              TriageCopilot works a synthetic patient&apos;s intake end to end, tool call by tool
              call, then hands every single case to a human clinician. Not because the prompt
              asks nicely: because the orchestrator enforces it.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-md bg-teal-300 px-5 py-2.5 text-sm font-semibold text-stone-900 transition-all hover:-translate-y-0.5 hover:bg-teal-200 hover:shadow-lg hover:shadow-teal-900/20"
              >
                View the live dashboard
              </Link>
              <Link
                href="/how-it-works"
                className="rounded-md border border-white/25 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-white/10"
              >
                See how it works
              </Link>
            </div>
            <p className="mt-8 text-xs text-stone-400">
              {patientCount !== null && (
                <>
                  {patientCount} synthetic patient{patientCount === 1 ? "" : "s"} currently on the
                  dashboard, live from this instance&apos;s own database
                  {" · "}
                </>
              )}
              <a
                href="https://github.com/Swarneil1905/TriageCopilot"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal-300 hover:underline"
              >
                View the source on GitHub →
              </a>
            </p>
          </div>

          {/* Real, verifiable numbers from this codebase in place of the
              customer-logo / adoption-stat row a funded product would show
              here: there is no customer base to cite honestly, so the claim
              this row makes is about the engineering, not the business,
              and every figure traces straight to a file in the repo. */}
          <Reveal className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="font-display text-3xl font-semibold text-stone-900">{s.value}</p>
                <p className="mt-1.5 text-xs leading-snug text-stone-500">{s.label}</p>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Watch the AI agent reason. The card below is framed as an actual
          browser window (traffic light dots, a real address bar showing
          the real route this data lives at), because it is one: everything
          inside is the same live, interactive AgentReasoningPanel a
          clinician sees on a real patient page, not a static image and not
          a mockup standing in for the product. */}
      <section className="border-b border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            <p className="font-mono-data text-xs uppercase tracking-wide text-stone-400">
              Live, from this instance&apos;s own database
            </p>
            <h2 className="font-display mt-2 text-3xl font-semibold text-stone-900">
              Watch the AI agent reason
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
              This is the actual conversation the triage agent produces on a real intake, not a
              mockup, not a screenshot standing in for it: the same chat panel, the same data, a
              clinician sees on a real patient page.
            </p>
          </Reveal>

          <Reveal delayMs={120} className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-900/5">
            <div className="flex items-center gap-3 border-b border-stone-100 bg-stone-100/70 px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
              </div>
              <span className="font-mono-data truncate rounded border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-500">
                triagecopilot.app/patients/{featuredPatientId ? featuredPatientId.slice(0, 8) : "…"}
              </span>
            </div>
            <div className="p-4">
              {featuredEvents ? (
                <>
                  <AgentReasoningPanel events={featuredEvents} llmProvider={llmProvider} defaultTraceOpen />
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
                  No completed triage run yet on this instance. Run the seed script or use the button below to
                  produce one.
                </p>
              )}
            </div>
          </Reveal>

          <div className="mt-6">
            <LiveDemoRunner />
          </div>
        </div>
      </section>

      {/* What this is / isn't */}
      <section className="mx-auto max-w-4xl px-6 py-10">
        <Reveal>
          <p className="border-l-2 border-stone-300 pl-4 text-sm leading-relaxed text-stone-600">
            <strong className="font-semibold text-stone-800">
              Synthetic demo data only, by design.
            </strong>{" "}
            No real patients, no real PHI, no real diagnoses or prescribing logic. This is a
            portfolio prototype built to demonstrate architecture: event sourcing, invariant
            enforcement, agent tool-calling, and a hard human-in-the-loop gate. The same
            primitives a real clinical ops platform is built from, at a scale honest about what it
            is.
          </p>
        </Reveal>
      </section>

      {/* Core design principles, as a numbered list rather than a feature-card
          grid: the content is closer to a resume's experience section (one
          claim, one proof) than to four interchangeable marketing bullets,
          so it reads that way instead of borrowing the generic SaaS
          feature-grid shape. */}
      <section className="border-y border-stone-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            <h2 className="font-display text-3xl font-semibold text-stone-900">
              What the architecture actually enforces
            </h2>
          </Reveal>
          <div className="mt-10 divide-y divide-stone-200 border-t border-stone-200">
            {PRINCIPLES.map((p, i) => (
              <Reveal key={p.title} delayMs={i * 90} className="grid grid-cols-[2.5rem_1fr] gap-4 py-6">
                <span className="font-mono-data pt-0.5 text-sm text-stone-300">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-semibold text-stone-900">{p.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Product-notes teaser */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <Reveal>
          <h2 className="font-display text-3xl font-semibold text-stone-900">
            Built after looking closely at what real triage products are missing
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-600">
            Before writing any of this, I read through how AI-native clinical-ops products
            actually talk about safety, audit trails, and human-in-the-loop review in practice,
            and where the gaps still are. Product notes lays out specifically what I noticed and
            how each piece of TriageCopilot answers it.
          </p>
          <Link
            href="/product-notes"
            className="mt-6 inline-block text-sm font-semibold text-teal-700 hover:underline"
          >
            Read the product notes →
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
