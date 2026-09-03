import { Fragment } from "react";
import { Reveal, RevealGroup } from "@/components/Reveal";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";

const STEPS = [
  {
    title: "1. Every write is one function, and it's transactional",
    body:
      "There is exactly one path into the events table: eventStore.appendEvent, inside a SERIALIZABLE transaction. It re-projects the patient's current state, checks the proposed event against the state machine's invariants, and only then inserts. An illegal transition (a clinician decision recorded before any triage ran, a follow-up scheduled twice) is rejected at that layer, not just hidden in the UI. Try it from curl instead of the dashboard and you still get a 409.",
  },
  {
    title: "2. The agent proposes, tool by tool: it never decides",
    body:
      "Each triage run gives the model four tools: look up prior history, flag a risk level, draft a clinical summary, and request human review. Every tool call is logged as its own TriageToolCalled event with its input and output, in order. That log is exactly what the dashboard's Agent Trace panel renders. Nothing the agent does mutates a patient's real status; it only ever produces a draft and a recommendation.",
  },
  {
    title: "3. The handoff is enforced by code, not by the prompt",
    body:
      "The system prompt tells the model to always finish with request_human_review. It doesn't matter whether the model actually calls it. The orchestrator itself writes TriageAgentCompleted and HumanReviewRequested as one atomic pair at the end of every run, regardless of what tool calls happened. If a future model update ever changed how compliant the model was about following instructions, this would keep the guarantee true.",
  },
  {
    title: "4. Failure has one job: never fail silently",
    body:
      "An LLM call that errors retries with exponential backoff, logging an AgentErrorOccurred event for every attempt. If every attempt fails, the patient is escalated straight to urgent_review rather than left stuck. And as a second, independent layer: if the projection ever finds a completed triage run with no matching review request for its run id (meaning the safety event itself somehow never made it), it forces urgent_review anyway. That's a deliberate answer to \"what if the safety-critical write silently failed.\"",
  },
  {
    title: "5. The model is swappable without touching the orchestrator",
    body:
      "The agent talks to an LLMProvider interface with one method: nextTurn. FakeProvider scripts deterministic tool calls so the whole demo, and the test suite, runs with zero API key and zero network calls. AnthropicProvider is a thin pass-through to Claude's tool-use API. OllamaProvider converts the same tool definitions into Ollama's native tool-calling shape and talks to a model running entirely on your own machine: same orchestrator, same invariants, same audit trail, different brain.",
  },
] as const;

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <Reveal>
        <p className="text-sm font-medium uppercase tracking-wide text-teal-700">How it works</p>
        <h1 className="font-display mt-2 text-3xl font-semibold text-stone-900">
          The architecture, and why it's built this way
        </h1>
        <p className="mt-4 text-stone-600">
          This isn&apos;t a CRUD app with an LLM call bolted on. The core idea is that events are
          the only source of truth, and every write goes through one invariant-checking gate,
          which is what makes the agent&apos;s safety guarantees structural instead of promised.
        </p>
      </Reveal>

      <Reveal delayMs={90} className="mt-8">
        <ArchitectureDiagram />
      </Reveal>

      <div className="mt-10 space-y-8">
        <RevealGroup>
          {STEPS.map((step) => (
            <Fragment key={step.title}>
              <h2 className="font-semibold text-stone-900">{step.title}</h2>
              <p className="mt-2 leading-relaxed text-stone-600">{step.body}</p>
            </Fragment>
          ))}
        </RevealGroup>
      </div>
    </div>
  );
}
