const GAPS = [
  {
    gap: "No visible crisis or safety-escalation path",
    note:
      "It's rarely obvious, from the outside, what happens when an AI tool encounters a patient who needs urgent attention right now. Does it quietly wait for the next scheduled review, or does something actually change?",
    answer:
      "TriageCopilot forces the answer to be visible. A high-risk flag routes straight to urgent_review, and, independently, if a completed triage run is ever missing its human-review handoff event, the state machine treats that as a safety failure on its own and escalates anyway. The escalation is a status the dashboard shows, not a log line you'd have to go looking for.",
  },
  {
    gap: "No visible audit trail or AI-disclosure UI",
    note:
      "\"The AI suggested X\" is easy to say and hard to actually show. A few clinical-AI products (Abridge's \"Linked Evidence\" is the clearest public example) have started making the connection between an AI output and the evidence behind it something a clinician can click into, not just trust.",
    answer:
      "Every patient's Agent Reasoning panel is the literal, ordered sequence of tool calls the agent made for its most recent run, input and output, including any retries, reconstructed straight from the event log. It's the same idea in spirit: click into a case, see exactly what produced the recommendation, not just the recommendation itself.",
  },
  {
    gap: "No visible intake or triage-routing logic",
    note:
      "A lot of \"AI intake\" demos show a chat box and a summary, with no visible model of what state a case is actually in or what's allowed to happen to it next.",
    answer:
      "TriageCopilot's patient status is a state machine, not a field you can set. Eight statuses, explicit legal transitions between them, enforced inside the same transaction that writes the event, so \"what's next for this patient\" is always a real, queryable answer instead of an assumption baked into the UI.",
  },
  {
    gap: "No visible clinical co-pilot or documentation surface",
    note:
      "Companies actually shipping in this space (Suki, Abridge, Nabla) are explicit that they're building scribes and co-workers, not autonomous decision-makers. The JD for this role describes the same thing: agents as \"operational co-workers.\"",
    answer:
      "The agent's draft_clinical_summary tool produces exactly that: a draft, explicitly never shown to the patient or auto-applied, that a clinician reviews, edits, or rejects through the same three-panel view as everything else. It's a co-worker's first pass, not a decision.",
  },
] as const;

const NEXT_STEPS = [
  {
    title: "A real evaluation suite",
    body:
      "Right now, correctness is proven by unit and integration tests against a scripted fake model. At production scale this needs an actual eval set: adversarial cases, boundary cases, a held-out set of \"should this escalate\" scenarios, run against every new model or prompt version before it ships, closer to how Abridge describes silent-release testing with partner health systems.",
  },
  {
    title: "A second-pass check before handoff",
    body:
      "An evaluator-optimizer step (Anthropic's term for it): a fast, cheap self-check that the drafted summary doesn't contradict the flagged risk level, or that a claimed \"low risk\" isn't paired with red-flag language in the intake, would catch a class of error before a human ever sees it. Not built here; the tool contract already supports adding it as one more step in the loop.",
  },
  {
    title: "Durable execution instead of hand-rolled retries",
    body:
      "The retry/backoff + append-only event log here is, functionally, a hand-rolled version of what Temporal or LangGraph's checkpointer pattern give you out of the box: crash recovery, resumable state, a built-in audit log. At real scale, that's the trade worth making instead of maintaining the hand-rolled version.",
  },
  {
    title: "Per-run tracing, not just the event log",
    body:
      "The event log answers \"what happened.\" It doesn't answer \"how much did this run cost, how long did each tool call take, which prompt version produced this.\" That's what Langfuse/LangSmith-style tracing is for, and it's a natural addition since every run already has a runId to key off of.",
  },
  {
    title: "Everything this project explicitly isn't",
    body:
      "Real auth and role-based access control, encryption at rest and in transit, a signed BAA, an actual HIPAA compliance program, connection to a real EHR. None of that is simulated here. It's named directly rather than glossed over, because pretending a portfolio prototype is compliance-ready would be a worse signal than just saying what's missing.",
  },
] as const;

export default function ProductNotesPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-teal-700">Product notes</p>
      <h1 className="font-display mt-2 text-3xl font-semibold text-stone-900">
        What I noticed, and how this answers it
      </h1>
      <p className="mt-4 leading-relaxed text-stone-600">
        Before building this, I read through Legion Health&apos;s own site and job description
        closely, alongside how a handful of companies actually shipping AI into clinical
        workflows (Abridge, Corti, Suki, Nabla) publicly describe their architecture and
        safety posture. A consistent thread: none of them are pitching an autonomous AI doctor.
        Legion&apos;s own framing is closer to what they&apos;ve called a &quot;Tesla
        model&quot;: a human clinician always in the loop, AI absorbing operational and
        administrative load incrementally. That&apos;s the model this project is built around,
        not a caricature of &quot;AI replaces clinicians&quot; that would be easy to build and
        wrong to ship.
      </p>

      <h2 className="font-display mt-12 text-xl font-semibold text-stone-900">
        Four gaps I noticed in how this space usually presents itself
      </h2>
      <div className="mt-6 space-y-6">
        {GAPS.map((g) => (
          <div key={g.gap} className="surface-flat p-5">
            <h3 className="font-semibold text-stone-900">{g.gap}</h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-500">{g.note}</p>
            <p className="mt-3 text-sm leading-relaxed text-stone-700">
              <span className="font-medium text-teal-700">How TriageCopilot answers it: </span>
              {g.answer}
            </p>
          </div>
        ))}
      </div>

      <h2 className="font-display mt-12 text-xl font-semibold text-stone-900">
        What I&apos;d add at production scale
      </h2>
      <p className="mt-3 text-sm text-stone-600">
        A prototype should say what it isn&apos;t, not just what it is. In roughly the order
        I&apos;d tackle them:
      </p>
      <div className="mt-6 space-y-6">
        {NEXT_STEPS.map((s, i) => (
          <div key={s.title}>
            <h3 className="font-semibold text-stone-900">
              {i + 1}. {s.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
