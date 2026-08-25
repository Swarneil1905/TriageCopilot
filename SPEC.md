# TriageCopilot — Project Spec

**One-liner:** An event-sourced care-ops prototype where an LLM triage agent works a synthetic patient's intake, then is *architecturally incapable* of closing the loop itself — every run ends in a `request_human_review` handoff to a clinician. Built as a portfolio piece for the Legion Health founding engineer role.

Status: draft spec, v0.1. This is the source of truth for scope — update it as decisions change, and treat every section below as something we agreed on, not something fixed in stone.

---

## 1. Motivation

Legion Health's founding engineer JD asks for someone who can: architect an event-driven backend, build LLM agents as coworkers with tool use/retries/safety rails, model canonical patient world-state, build ops UX that shows "what happened, why, what's next," and keep PHI-style data auditable. Their hiring process is a systems deep-dive ("walk through 1-2 systems you've shipped") followed by a practical LLM-systems work trial. Rather than write a generic full-stack CRUD app, this project is scoped to be a small, complete, defensible answer to exactly those two interview stages: a system worth walking through, built the way their actual work trial would ask for.

It is a **synthetic, non-clinical demo**. No real patients, no real diagnoses, no real prescribing logic. The point is the architecture: event sourcing, invariant enforcement, agent tool-calling, and a hard human-in-the-loop gate.

## 2. Naming

**Project name: `TriageCopilot`.**

Rationale: it says exactly what the thing is on first read, with no decoding required — an AI copilot that handles triage, while a human clinician stays in charge and signs off before anything is final. Same "copilot" pattern most people already know from GitHub/Microsoft Copilot: the AI drives the first pass, the human keeps the wheel. Repo name: `triage-copilot`. Package scope: `@triage-copilot/*`.

## 3. Explicit non-goals

- Not HIPAA-compliant, not connected to any real EHR, not handling real PHI. All patients are synthetic and clearly labeled as such in the UI and README.
- Not a real clinical decision support tool. The agent's output is always a *draft* for a human, never an autonomous action.
- Not attempting to match Legion's actual scale, regulatory posture, or production hardening. It demonstrates the primitives, not the whole company.

## 4. Working agreement (process + git)

- This session (Claude, in a cloud sandbox, and via the device bridge on this machine) reads and writes files inside this project folder, and helps design/implement/test each task below.
- **Claude does not run `git init`, `git add`, `git commit`, or `git push` inside this project.** All commits and all pushes to GitHub are done by you, from your own machine (Cursor, terminal, whatever you prefer), using your own git identity. The GitHub contributor history is yours alone.
- Suggested loop: we finish a task from the breakdown in §14 → you review the diff (in Cursor or wherever) → you commit it yourself with your own message → you push → we move to the next task. Small, reviewable commits per task make for a good commit history if anyone looks at it.
- One honest note, not a directive: you don't need to hide that you used AI tools to build this. For a company literally pitching "shifting this industry's economics from humans to tokens" and hiring for AI-native systems, being able to say "I used Claude/Cursor heavily and here's specifically what I designed vs. what I generated and verified" is a *plus*, not a minus — their own interview process is built to test whether you understand the system, not whether you typed every character. That's your call to make either way; just flagging it once.

## 5. Architecture overview

```mermaid
flowchart LR
    subgraph Client
        UI[Next.js ops dashboard]
    end

    subgraph Backend[Node/TS backend]
        API[Fastify REST API]
        SM[State machine\n(pure projection + invariants)]
        ES[Event store\n(append-only, transactional)]
        AG[Triage agent orchestrator]
        TOOLS[Agent tools]
        LLM[LLM provider\n(Fake | Anthropic)]
    end

    DB[(Postgres / Supabase\npatients + events)]

    UI <--> API
    API --> ES
    API --> AG
    AG --> TOOLS
    AG --> LLM
    AG --> ES
    ES --> SM
    ES <--> DB
```

Core idea: **events are the only source of truth.** `patients` holds identity fields that never change; everything about a patient's journey — status, risk level, what the agent said, what the clinician decided — is a pure fold over their event stream (`stateMachine.ts::projectPatientState`). The dashboard, the API, and the agent's own "memory" all read the same projection. Nothing mutates in place; you can always answer "what did this look like at 2:14pm" by replaying events up to a timestamp.

Every write goes through one function, `eventStore.appendEvent`, which — inside a `SERIALIZABLE` transaction — re-projects current state, checks the new event against `stateMachine.ts::assertValidAppend`, and only then inserts. Illegal transitions (e.g., a clinician decision recorded before any triage ran) are rejected at the write path, not just hidden in the UI.

## 6. Tech stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js + TypeScript | Matches the JD's stack exactly. |
| DB | Postgres via Supabase-style migrations (`supabase/migrations/`), local dev via `docker-compose` | Same schema you'd hand to a real Supabase project unchanged; `docker-compose` stands in for `supabase start` so no live Supabase project is required to run this. |
| API framework | Fastify | Lightweight, fast to reason about, first-class TS support. |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`), tool-calling | JD lists both OpenAI and Anthropic; Anthropic's tool-use API maps cleanly onto the tool contract described below. |
| LLM provider abstraction | `LLMProvider` interface with `AnthropicProvider` + `FakeProvider` | The whole demo (seed data, tests, UI) runs with zero API key using `FakeProvider`'s deterministic scripted responses. Flip `LLM_PROVIDER=anthropic` + a real key to see live tool-calling. Also exactly how you'd want agent evals to work in CI — no LLM spend to run the test suite. |
| Frontend | Next.js 15 (App Router) + Tailwind | Matches the JD's frontend stack. |
| Tests | Vitest | Fast, good TS support, minimal config. |

## 7. Data model

Two tables (full DDL in `supabase/migrations/0001_init.sql`):

**`patients`** — `id`, `display_name`, `synthetic` (always `true` here), `created_at`. Identity only; never mutated by the state machine.

**`events`** — `id`, `patient_id`, `run_id` (nullable, groups all events from one agent invocation), `type`, `actor_type` (`system | agent | clinician`), `actor_name`, `payload` (jsonb), `created_at`. Append-only in application code — no `UPDATE`/`DELETE` anywhere in `eventStore.ts`.

Event types and their payloads:

| Event | Actor | Payload |
|---|---|---|
| `PatientCreated` | system | `{}` |
| `IntakeFormSubmitted` | system | `{ chief_complaint, phq9_score, gad7_score, free_text }` |
| `TriageAgentStarted` | agent | `{}` (carries `run_id`) |
| `TriageToolCalled` | agent | `{ tool_name, input, output }` — one per tool call, this is the raw material for the "agent reasoning" panel |
| `TriageAgentCompleted` | agent | `{ riskLevel, summary, recommended_next_step }` |
| `HumanReviewRequested` | agent | `{ reason }` — must share `run_id` with the `TriageAgentCompleted` it follows |
| `ClinicianDecisionRecorded` | clinician | `{ decision: approved\|rejected\|modified, note, clinician_name }` |
| `FollowUpScheduled` | system | `{ date, method }` |
| `AgentErrorOccurred` | agent | `{ error, retry_count, escalated }` |

## 8. State machine spec

Statuses: `intake_pending → intake_submitted → triage_in_progress → {pending_clinician_review | urgent_review} → {clinician_approved | clinician_rejected} → follow_up_scheduled`, with `clinician_rejected` looping back to a fresh `triage_in_progress`.

Invariants enforced in `assertValidAppend` (checked on every write, not just in the UI):

1. `IntakeFormSubmitted` only from `intake_pending`.
2. `TriageAgentStarted` only from `intake_submitted` or `clinician_rejected`, and only if no run is already in progress.
3. `TriageToolCalled` / `TriageAgentCompleted` / `AgentErrorOccurred` only while `triage_in_progress`, and only with a `run_id` matching the in-progress run.
4. `ClinicianDecisionRecorded` only from `pending_clinician_review` or `urgent_review` — a human cannot act before the agent has completed a triage *and* that triage has been formally handed off for review.
5. `FollowUpScheduled` only from `clinician_approved`.
6. **Defense-in-depth catch:** if `projectPatientState` ever finds a `TriageAgentCompleted` with no matching `HumanReviewRequested` for that `run_id`, it does not let the patient look "fine" — it forces status to `urgent_review` with a `safetyAlert` explaining that the handoff never happened and this needs engineering attention before anyone treats the case as reviewed. This is a deliberate "what if the safety-critical event silently failed to write" scenario, and a good failure-mode to talk through in the interview.

## 9. Agent spec

Tools exposed to the model (`agents/tools.ts`), in the shape Anthropic's tool-use API expects:

- `get_patient_history` — reads real data (prior triage runs, prior clinician decisions from the event log). The only tool that's a real read.
- `flag_risk_level(risk_level, justification)` — records an assessment; does not act on it.
- `draft_clinical_summary(summary, recommended_next_step)` — a draft for a human, explicitly never shown to the patient or auto-applied.
- `request_human_review(reason)` — **mandatory final step.** The model is told in its system prompt it may never approve/deny/prescribe/close a case itself.

Orchestration (`agents/triageAgent.ts`, to be built in Task 4):

1. Emit `TriageAgentStarted`.
2. Loop: call the LLM provider with the tool set + conversation so far; for each tool call the model makes, execute it (`executeTool`) and log a `TriageToolCalled` event; feed the tool result back to the model. Cap at a small number of turns.
3. Wrap each LLM call in retry-with-backoff (max 3 attempts). On repeated failure, log `AgentErrorOccurred` with `escalated: true` rather than silently dropping the patient — this is what pushes the case straight to `urgent_review` via the state machine's escalation path, so a broken agent run still gets a human's eyes on it.
4. **Orchestrator-enforced guardrail, not just prompted:** even if the model's tool-call sequence somehow skips `request_human_review`, the orchestrator itself emits `TriageAgentCompleted` + `HumanReviewRequested` as the run's closing step. The system prompt asks the model to call the tool; the code guarantees it happens regardless. This is the difference between "we told the agent to be safe" and "the agent is structurally unable to not be safe," and it's worth being able to explain that distinction clearly in the interview.

`LLMProvider` interface: one method, take the running message list + tool defs, return either a tool-call request or a final text response. `FakeProvider` scripts deterministic tool-call sequences (including one scenario that deliberately omits `request_human_review`, to exercise guardrail #4 above, and one that throws twice before succeeding, to exercise retries). `AnthropicProvider` is a thin wrapper over `@anthropic-ai/sdk`'s messages API with `tools:`.

## 10. REST API spec

All under `/api`. JSON in, JSON out.

| Method & path | Purpose |
|---|---|
| `POST /patients` | Create a synthetic patient (`{ display_name }`). |
| `GET /patients` | List all patients with their current projected world-state (for the dashboard list view). |
| `GET /patients/:id` | Full world-state + full event timeline for one patient. |
| `POST /patients/:id/intake` | Submit the intake form (`IntakeFormSubmitted`). |
| `POST /patients/:id/run-triage` | Kick off a triage agent run; blocks until the run completes (or fails/escalates) and returns the updated state. |
| `POST /patients/:id/clinician-decision` | Record a clinician's decision (`{ decision, note, clinician_name }`). |
| `POST /patients/:id/schedule-follow-up` | Record `FollowUpScheduled` (`{ date, method }`). |
| `GET /patients/:id/audit-log` | Raw event list, for the "what happened, why" audit view — same data as `GET /patients/:id` but framed as an audit export. |

Invariant violations surface as `409` with the `InvariantViolationError` message; the frontend renders these inline rather than silently failing.

## 11. Frontend spec

Next.js 15 App Router, Tailwind, no auth (out of scope for a demo).

- **`/`** — patient list: name, status badge (color-coded, `urgent_review` in red), risk level, last-updated timestamp. A persistent banner: "Synthetic demo data only — not a real clinical system."
- **`/patients/[id]`** — three-panel layout:
  1. **Timeline** — every event in order, icon by `actor_type`, expandable payload.
  2. **Agent reasoning** — for the most recent run, the sequence of `TriageToolCalled` events with tool name, input, output, in order. This is the literal answer to "what happened and why."
  3. **What's next** — the state machine's `nextAction` string, plus (when status is `pending_clinician_review` / `urgent_review`) a form for the clinician to approve/reject/modify with a note, which posts to `clinician-decision`.

## 12. Testing strategy

- `stateMachine.test.ts` — projection correctness over hand-built event sequences; every invariant in §8 has at least one test that a violating append throws. **Done** (12 tests, all passing, pure/offline — no DB needed).
- `triageAgent.test.ts` (against `FakeProvider`) — the "skips request_human_review" scenario still results in a `HumanReviewRequested` event; the "fails twice then succeeds" scenario logs two `AgentErrorOccurred` events and still completes; a forced-permanent-failure scenario ends in `urgent_review` with a `safetyAlert`.
- `scripts/smoke.ts` — a manual, real-Postgres smoke test (not part of the vitest suite) exercising the actual DB transaction + invariant enforcement end to end: create patient → intake → triage run → review request → a rejected premature follow-up → clinician approval → follow-up scheduled. Run with `npm run backend:smoke` once `docker compose up -d db` is running. **Done** — verified against a real local Postgres.
- One smoke-level API integration test hitting a real (docker) Postgres: create patient → submit intake → run triage (fake provider) → clinician approves → schedule follow-up, asserting status at each step (planned for Task 5, at the HTTP layer).

## 13. How to run locally

```
cp .env.example .env
docker compose up -d db        # local Postgres, migrations auto-applied
npm install
npm run backend:test           # runs with LLM_PROVIDER=fake, no API key needed
npm run backend:smoke          # optional: real-DB smoke test (see §12)
npm run backend:seed           # populates synthetic patients
npm run backend:dev            # API on :4000
npm run frontend:dev           # dashboard on :3000
```

To see the live Anthropic-backed agent instead of the fake one: set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env`.

## 14. Progress task breakdown

Each task below is scoped to be one reviewable commit. Suggested order top to bottom; 2 and 3 can happen in either order.

1. **Repo scaffold** — workspaces `package.json`, `docker-compose.yml`, `supabase/migrations/0001_init.sql`, `.env.example`. ✅ Done.
2. **Event store & state machine** — `types.ts`, `db.ts`, `eventStore.ts`, `stateMachine.ts` + unit tests for every invariant. ✅ Done — 12/12 vitest tests passing (pure, no DB required), plus a real-Postgres smoke script (`scripts/smoke.ts`) verifying the transactional write path end to end. One real bug caught and fixed by the tests: `assertValidAppend` originally rejected `PatientCreated` unconditionally instead of only when it wasn't genuinely the first event.
3. **Agent tools & LLM provider** — `tools.ts`, `llmProvider.ts` (`FakeProvider` + `AnthropicProvider`) + unit tests against the fake.
4. **Triage agent orchestrator** — `triageAgent.ts`: the tool loop, retry/backoff, forced-handoff guarantee, escalation on repeated failure + tests for both guardrail scenarios.
5. **REST API** — Fastify server + all routes in §10 + one integration smoke test against real Postgres.
6. **Seed script** — synthetic patients: one normal end-to-end, one high-risk (urgent path), one agent-failure-then-retry, one fresh/untouched intake.
7. **Frontend dashboard** — patient list + patient detail (timeline, agent reasoning, next-action + clinician form), Tailwind styling, disclaimer banner.
8. **End-to-end pass** — run migrations, seed, click through the full UI flow for each synthetic patient, confirm the audit trail reads correctly and invariants can't be bypassed from the UI.
9. **README** — architecture diagram, how to run, explicit synthetic-data disclaimer, and a short section mapping each JD bullet to the file(s) that answer it (for your systems deep-dive).
10. *(Stretch, optional)* — deploy the frontend + a hosted Postgres somewhere (Railway is a reasonable pick) for a live link, or record a short demo walkthrough video/GIF.

## 15. Mapping to the Legion Health JD

For your systems deep-dive prep — each JD bullet, answered by:

- *"Architect and scale our event-driven backend... clean state machines and event streams"* → §5, §7, §8 (`eventStore.ts`, `stateMachine.ts`).
- *"Build real LLM agents as coworkers... tool use, retries, memory, safety rails... evaluation loops"* → §9 (`agents/triageAgent.ts`, `agents/tools.ts`, `agents/llmProvider.ts`, `triageAgent.test.ts`).
- *"Shape human + AI ops UX... what happened, why, and what should happen next"* → §11 (the three-panel patient detail page).
- *"Define world-state & simulation... power alerting, routing, decision-making"* → §8 (`projectPatientState` as the single source of derived state; the defense-in-depth escalation is the "alerting" primitive).
- *"Own data, safety & compliance... PHI access, agent actions, and human overrides are all auditable"* → §7 event log (`actor_type` on every row) + §10 `/audit-log` endpoint. (With the explicit caveat from §3: this demonstrates the pattern, not real HIPAA compliance.)
