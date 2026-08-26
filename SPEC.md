# TriageCopilot - Project Spec

**One-liner:** An event-sourced care-ops prototype where an LLM triage agent works a synthetic patient's intake, then is *architecturally incapable* of closing the loop itself - every run ends in a `request_human_review` handoff to a clinician. Built as a portfolio piece for the Legion Health founding engineer role.

Status: draft spec, v0.1. This is the source of truth for scope - update it as decisions change, and treat every section below as something we agreed on, not something fixed in stone.

---

## 1. Motivation

Legion Health's founding engineer JD asks for someone who can: architect an event-driven backend, build LLM agents as coworkers with tool use/retries/safety rails, model canonical patient world-state, build ops UX that shows "what happened, why, what's next," and keep PHI-style data auditable. Their hiring process is a systems deep-dive ("walk through 1-2 systems you've shipped") followed by a practical LLM-systems work trial. Rather than write a generic full-stack CRUD app, this project is scoped to be a small, complete, defensible answer to exactly those two interview stages: a system worth walking through, built the way their actual work trial would ask for.

It is a **synthetic, non-clinical demo**. No real patients, no real diagnoses, no real prescribing logic. The point is the architecture: event sourcing, invariant enforcement, agent tool-calling, and a hard human-in-the-loop gate.

## 2. Naming

**Project name: `TriageCopilot`.**

Rationale: it says exactly what the thing is on first read, with no decoding required - an AI copilot that handles triage, while a human clinician stays in charge and signs off before anything is final. Same "copilot" pattern most people already know from GitHub/Microsoft Copilot: the AI drives the first pass, the human keeps the wheel. Repo name: `triage-copilot`. Package scope: `@triage-copilot/*`.

## 3. Explicit non-goals

- Not HIPAA-compliant, not connected to any real EHR, not handling real PHI. All patients are synthetic and clearly labeled as such in the UI and README.
- Not a real clinical decision support tool. The agent's output is always a *draft* for a human, never an autonomous action.
- Not attempting to match Legion's actual scale, regulatory posture, or production hardening. It demonstrates the primitives, not the whole company.

## 4. Working agreement (process + git)

- This session (Claude, in a cloud sandbox, and via the device bridge on this machine) reads and writes files inside this project folder, and helps design/implement/test each task below.
- **Claude does not run `git init`, `git add`, `git commit`, or `git push` inside this project.** All commits and all pushes to GitHub are done by you, from your own machine (Cursor, terminal, whatever you prefer), using your own git identity. The GitHub contributor history is yours alone.
- Suggested loop: we finish a task from the breakdown in §14 → you review the diff (in Cursor or wherever) → you commit it yourself with your own message → you push → we move to the next task. Small, reviewable commits per task make for a good commit history if anyone looks at it.
- One honest note, not a directive: you don't need to hide that you used AI tools to build this. For a company literally pitching "shifting this industry's economics from humans to tokens" and hiring for AI-native systems, being able to say "I used Claude/Cursor heavily and here's specifically what I designed vs. what I generated and verified" is a *plus*, not a minus - their own interview process is built to test whether you understand the system, not whether you typed every character. That's your call to make either way; just flagging it once.
- This file itself (`SPEC.md`) is intentionally **not** pushed to GitHub - it's untracked and stays local-only as our working task list. The public-facing writeup lives in `README.md` (Task 9).

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

Core idea: **events are the only source of truth.** `patients` holds identity fields that never change; everything about a patient's journey - status, risk level, what the agent said, what the clinician decided - is a pure fold over their event stream (`stateMachine.ts::projectPatientState`). The dashboard, the API, and the agent's own "memory" all read the same projection. Nothing mutates in place; you can always answer "what did this look like at 2:14pm" by replaying events up to a timestamp.

Every write goes through one function, `eventStore.appendEvent`, which - inside a `SERIALIZABLE` transaction - re-projects current state, checks the new event against `stateMachine.ts::assertValidAppend`, and only then inserts. Illegal transitions (e.g., a clinician decision recorded before any triage ran) are rejected at the write path, not just hidden in the UI.

## 6. Tech stack & rationale

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js + TypeScript | Matches the JD's stack exactly. |
| DB | Postgres via Supabase-style migrations (`supabase/migrations/`), local dev via `docker-compose` | Same schema you'd hand to a real Supabase project unchanged; `docker-compose` stands in for `supabase start` so no live Supabase project is required to run this. |
| API framework | Fastify | Lightweight, fast to reason about, first-class TS support. |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`), tool-calling | JD lists both OpenAI and Anthropic; Anthropic's tool-use API maps cleanly onto the tool contract described below. |
| LLM provider abstraction | `LLMProvider` interface with `AnthropicProvider` + `FakeProvider` | The whole demo (seed data, tests, UI) runs with zero API key using `FakeProvider`'s deterministic scripted responses. Flip `LLM_PROVIDER=anthropic` + a real key to see live tool-calling. Also exactly how you'd want agent evals to work in CI - no LLM spend to run the test suite. |
| Frontend | Next.js 15 (App Router) + Tailwind | Matches the JD's frontend stack. |
| Tests | Vitest | Fast, good TS support, minimal config. |

## 7. Data model

Two tables (full DDL in `supabase/migrations/0001_init.sql`):

**`patients`** - `id`, `display_name`, `synthetic` (always `true` here), `created_at`. Identity only; never mutated by the state machine.

**`events`** - `id`, `patient_id`, `run_id` (nullable, groups all events from one agent invocation), `type`, `actor_type` (`system | agent | clinician`), `actor_name`, `payload` (jsonb), `created_at`. Append-only in application code - no `UPDATE`/`DELETE` anywhere in `eventStore.ts`.

Event types and their payloads:

| Event | Actor | Payload |
|---|---|---|
| `PatientCreated` | system | `{}` |
| `IntakeFormSubmitted` | system | `{ chief_complaint, phq9_score, gad7_score, free_text }` |
| `TriageAgentStarted` | agent | `{}` (carries `run_id`) |
| `TriageToolCalled` | agent | `{ tool_name, input, output }` - one per tool call, this is the raw material for the "agent reasoning" panel |
| `TriageAgentCompleted` | agent | `{ riskLevel, summary, recommended_next_step }` |
| `HumanReviewRequested` | agent | `{ reason }` - must share `run_id` with the `TriageAgentCompleted` it follows |
| `ClinicianDecisionRecorded` | clinician | `{ decision: approved\|rejected\|modified, note, clinician_name }` |
| `FollowUpScheduled` | system | `{ date, method }` |
| `AgentErrorOccurred` | agent | `{ error, retry_count, escalated }` |

## 8. State machine spec

Statuses: `intake_pending → intake_submitted → triage_in_progress → {pending_clinician_review | urgent_review} → {clinician_approved | clinician_rejected} → follow_up_scheduled`, with `clinician_rejected` looping back to a fresh `triage_in_progress`.

Invariants enforced in `assertValidAppend` (checked on every write, not just in the UI):

1. `IntakeFormSubmitted` only from `intake_pending`.
2. `TriageAgentStarted` only from `intake_submitted` or `clinician_rejected`, and only if no run is already in progress.
3. `TriageToolCalled` / `TriageAgentCompleted` / `AgentErrorOccurred` only while `triage_in_progress`, and only with a `run_id` matching the in-progress run.
4. `ClinicianDecisionRecorded` only from `pending_clinician_review` or `urgent_review` - a human cannot act before the agent has completed a triage *and* that triage has been formally handed off for review.
5. `FollowUpScheduled` only from `clinician_approved`.
6. **Defense-in-depth catch:** if `projectPatientState` ever finds a `TriageAgentCompleted` with no matching `HumanReviewRequested` for that `run_id`, it does not let the patient look "fine" - it forces status to `urgent_review` with a `safetyAlert` explaining that the handoff never happened and this needs engineering attention before anyone treats the case as reviewed. This is a deliberate "what if the safety-critical event silently failed to write" scenario, and a good failure-mode to talk through in the interview.

## 9. Agent spec

Tools exposed to the model (`agents/tools.ts`), in the shape Anthropic's tool-use API expects:

- `get_patient_history` - reads real data (prior triage runs, prior clinician decisions from the event log). The only tool that's a real read.
- `flag_risk_level(risk_level, justification)` - records an assessment; does not act on it.
- `draft_clinical_summary(summary, recommended_next_step)` - a draft for a human, explicitly never shown to the patient or auto-applied.
- `request_human_review(reason)` - **mandatory final step.** The model is told in its system prompt it may never approve/deny/prescribe/close a case itself.

Orchestration (`agents/triageAgent.ts`, to be built in Task 4):

1. Emit `TriageAgentStarted`.
2. Loop: call the LLM provider with the tool set + conversation so far; for each tool call the model makes, execute it (`executeTool`) and log a `TriageToolCalled` event; feed the tool result back to the model. Cap at a small number of turns.
3. Wrap each LLM call in retry-with-backoff (max 3 attempts). On repeated failure, log `AgentErrorOccurred` with `escalated: true` rather than silently dropping the patient - this is what pushes the case straight to `urgent_review` via the state machine's escalation path, so a broken agent run still gets a human's eyes on it.
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
| `GET /patients/:id/audit-log` | Raw event list, for the "what happened, why" audit view - same data as `GET /patients/:id` but framed as an audit export. |

Invariant violations surface as `409` with the `InvariantViolationError` message; the frontend renders these inline rather than silently failing.

## 11. Frontend spec

Next.js 15 App Router, Tailwind, no auth (out of scope for a demo).

- **`/`** - patient list: name, status badge (color-coded, `urgent_review` in red), risk level, last-updated timestamp. A persistent banner: "Synthetic demo data only - not a real clinical system."
- **`/patients/[id]`** - three-panel layout:
  1. **Timeline** - every event in order, icon by `actor_type`, expandable payload.
  2. **Agent reasoning** - for the most recent run, the sequence of `TriageToolCalled` events with tool name, input, output, in order. This is the literal answer to "what happened and why."
  3. **What's next** - the state machine's `nextAction` string, plus (when status is `pending_clinician_review` / `urgent_review`) a form for the clinician to approve/reject/modify with a note, which posts to `clinician-decision`.

## 12. Testing strategy

- `stateMachine.test.ts` - projection correctness over hand-built event sequences; every invariant in §8 has at least one test that a violating append throws. **Done** (12 tests, all passing, pure/offline - no DB needed).
- `triageAgent.test.ts` (against `FakeProvider`) - the "skips request_human_review" scenario still results in a `HumanReviewRequested` event; the "fails twice then succeeds" scenario logs two `AgentErrorOccurred` events and still completes; a forced-permanent-failure scenario ends in `urgent_review` with a `safetyAlert`. **Done** (6 tests, all passing, against `InMemoryEventLog` + `FakeProvider`).
- `scripts/smoke.ts` - a manual, real-Postgres smoke test (not part of the vitest suite) exercising the actual DB transaction + invariant enforcement end to end: create patient → intake → triage run → review request → a rejected premature follow-up → clinician approval → follow-up scheduled. Run with `npm run backend:smoke` once `docker compose up -d db` is running. **Done** - verified against a real local Postgres.
- One smoke-level API integration test hitting a real (docker) Postgres: create patient → submit intake → run triage (fake provider) → clinician approves → schedule follow-up, asserting status at each step. **Done** (`test/api.test.ts`, 5 tests, all run against real Postgres).

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

1. **Repo scaffold** - workspaces `package.json`, `docker-compose.yml`, `supabase/migrations/0001_init.sql`, `.env.example`. ✅ Done.
2. **Event store & state machine** - `types.ts`, `db.ts`, `eventStore.ts`, `stateMachine.ts` + unit tests for every invariant. ✅ Done - 12/12 vitest tests passing (pure, no DB required), plus a real-Postgres smoke script (`scripts/smoke.ts`) verifying the transactional write path end to end. One real bug caught and fixed by the tests: `assertValidAppend` originally rejected `PatientCreated` unconditionally instead of only when it wasn't genuinely the first event.
3. **Agent tools & LLM provider** - `tools.ts`, `llmProvider.ts` (`FakeProvider` + `AnthropicProvider`) + unit tests against the fake. ✅ Done - 9 new tests (21 total passing). `AnthropicProvider` dynamic-imports the SDK so the fake-only path never needs it installed at runtime; verified the SDK actually resolves in this environment.
4. **Triage agent orchestrator** - `triageAgent.ts`: the tool loop, retry/backoff, forced-handoff guarantee, escalation on repeated failure + tests for both guardrail scenarios. ✅ Done - 6 new tests (folded into the 32-test total confirmed in task 5). Covers: happy path via the model's own `request_human_review` call, the orchestrator forcing that handoff even when the model never calls the tool, one-failure-then-recover logging a single `AgentErrorOccurred`, escalation to `urgent_review` when every retry attempt fails, a high-risk flag routing straight to `urgent_review`, and forced completion + handoff if the model keeps calling tools past `maxTurns`. Introduced the `EventLog` ports-and-adapters interface (`PgEventLog` / `InMemoryEventLog`) specifically so these tests could stay DB-free while exercising the real invariant-checking code path, plus the new `appendEvents` transactional write so `TriageAgentCompleted` + `HumanReviewRequested` land atomically.
5. **REST API** - Fastify server + all routes in §10 + one integration smoke test against real Postgres. ✅ Done - 5 new tests (32 total passing), all run against real Postgres in this pass. Bumped fastify 4 -> 5 (and @fastify/cors to match) while building this, since v4 had 2 high-severity advisories with no reason not to be on the fixed version for a server being built from scratch. Also added UUID validation on the :id route param so a malformed id 400s instead of leaking a raw Postgres error as a 500, and split app.ts (buildServer) from server.ts (the process entrypoint) so tests hit real routes via fastify.inject() without binding a port. Also verified server.ts actually boots and answers real HTTP requests over curl, not just via inject().
6. **Seed script** - synthetic patients: one normal end-to-end, one high-risk (urgent path), one agent-failure-then-retry, one fresh/untouched intake. ✅ Done - `npm run backend:seed` truncates `events`/`patients` (idempotent, safe to re-run) then creates 4 fictional patients, verified end to end against real Postgres: Alex Rivera reaches `follow_up_scheduled` via the full happy path (intake → low-risk triage → clinician approval → follow-up), Jordan Blake is deliberately left at `urgent_review` for a clinician to act on, Sam Okafor hits one simulated `AgentErrorOccurred` (via `FakeProvider`'s `failFirstNCalls`) and recovers via retry to `pending_clinician_review`, and Morgan Ellis is left fresh at `intake_pending` with no intake submitted. Confirmed via direct SQL query that the event log for each patient is exactly as expected, including the `TriageAgentCompleted` + `HumanReviewRequested` guardrail pair on both the low- and high-risk patients. Full 32-test suite re-run and still green after this change.
7. **Frontend dashboard** - patient list + patient detail (timeline, agent reasoning, next-action + clinician form), Tailwind styling, disclaimer banner. ✅ Done - Next.js 15.5.23 (App Router) + Tailwind v4, `lib/api.ts` with types copy-pasted from the backend's `types.ts` (by design, per the comment there) and a thin fetch client hitting the Fastify API directly (`NEXT_PUBLIC_API_BASE_URL`, defaults to `http://localhost:4000/api`). `/` lists all patients with color-coded status + risk badges and a "+ New synthetic patient" control; `/patients/[id]` is the three-panel layout from §11 (Timeline with expandable payloads, Agent reasoning showing the most recent run's tool calls in order including any retries, What's next rendering the state machine's `nextAction` plus whichever form the current status actually allows - intake, run-triage, clinician-decision, or schedule-follow-up). The disclaimer banner is a persistent top bar on every page. Verified: production build is clean (`next build`, no type errors); then real end-to-end click-through in a headless browser (Playwright, since this runs in a cloud sandbox rather than your machine) driving Morgan Ellis through intake → run-triage → clinician approval → follow-up entirely through the rendered UI, plus static checks of Jordan Blake (high-risk → urgent_review, clinician form) and Sam Okafor (the simulated retry shows up correctly in the reasoning panel). One real bug caught this way: the fetch client always sent `Content-Type: application/json`, even on the body-less `run-triage` POST, which Fastify's body parser rejects outright (`FST_ERR_CTP_EMPTY_JSON_BODY`) - fixed by only setting that header when a body is actually present. Backend's 32-test suite re-confirmed green after the frontend work (shared nothing, but good to re-check). One documented `npm audit` call: after installing the frontend, `npm audit` reports 3 high-severity findings in Next.js's own bundled `postcss`/`sharp` (build-time CSS/image tooling, not runtime request-handling), plus a pre-existing critical finding in `vitest`'s dev-only UI-server dependency chain (surfaced now because this was the first time I ran a full audit rather than one scoped to `--omit=dev` as in Task 5). Both fixes require a major bump (Next 16, or Vitest 4) that would either break the explicit "match Legion's Next 15 stack" goal or risk destabilizing the already-verified 32-test suite, for issues that require attacker-controlled build input or an opt-in `vitest --ui` flag this project never uses. Deliberately left as-is for a local, non-internet-facing demo -- documenting the trade-off here rather than silently ignoring it, same spirit as the fastify bump in Task 5, just the opposite call.
8. **End-to-end pass** - run migrations, seed, click through the full UI flow for each synthetic patient, confirm the audit trail reads correctly and invariants can't be bypassed from the UI. ✅ Done - this is also the point where you got the app running live on your own machine (Postgres via `docker compose up -d db`, `npm run backend:seed`, both dev servers), confirming the four seeded patients render correctly end to end outside my sandbox too. On top of that I ran a full scripted click-through (Playwright, against a fresh reseed): Morgan Ellis went through every step from a blank patient (submit intake -> run triage -> clinician approval -> schedule follow-up), Jordan Blake's `urgent_review` state was confirmed to show the urgent badge, high-risk badge, and URGENT next-action text before being resolved the same way, and Sam Okafor was resolved from `pending_clinician_review` through to follow-up. Zero console/page errors across the whole pass. Pulled the audit-log endpoint directly and confirmed Morgan's 11-event trail is in the exact right order (create -> intake -> triage started -> 4 tool calls -> completed -> review requested -> clinician decision -> follow-up). For "invariants can't be bypassed," went beyond just checking the UI doesn't offer an illegal action: called the API directly to try scheduling a follow-up on an already-completed patient and recording a clinician decision on a fresh intake-only patient, both correctly rejected with 409 and a clear error message, and confirmed the UI itself shows only the terminal "nothing further to action" message once a patient resolves, never a stale form for a status that's moved on. Sandbox reseeded back to the pristine 4-patient state afterward; your own machine's data was untouched throughout, since this ran against my sandbox's separate database. No source changes this task, so nothing new to commit.
9. **README** - architecture diagram, how to run, explicit synthetic-data disclaimer, and a short section mapping each JD bullet to the file(s) that answer it (for your systems deep-dive). Content will be expanded by task 13's product-gap narrative rather than written as a separate, smaller pass.
10. *(Stretch, optional)* - deploy the frontend + a hosted Postgres somewhere (Railway is a reasonable pick) for a live link, or record a short demo walkthrough video/GIF.

### Pivot: from "working demo" to "founding-engineer edge"

After the first end-to-end pass, feedback was that the dashboard alone reads as a generic Tailwind CRUD demo, not something that shows founding-engineer-level product thinking. Three follow-on tasks address that, informed by research into Legion Health's real site (it focuses on operational bottlenecks - scheduling, documentation, billing, intake, risk detection - not automating diagnosis) and the JD's explicit call for "agent loops with tool use, memory, retry logic, and feedback mechanisms that function as operational co-workers" and "human-AI collaboration UX."

11. **Ollama LLM provider** - `OllamaProvider` in `llmProvider.ts`, implementing the same `LLMProvider` interface as `FakeProvider`/`AnthropicProvider`. Converts `AGENT_TOOLS` from Anthropic's `{name, description, input_schema}` shape into Ollama's native OpenAI-function `{type: "function", function: {name, description, parameters}}` shape for its documented `/api/chat` endpoint, and flattens the tool_use/tool_result message history into Ollama's flat `{role, content}` message list (tracking tool_use_id -> tool name across the conversation, since Ollama's tool-result messages only take a name, not an id). ✅ Done - 8 new unit tests (48 total passing across the backend suite) against a mocked `fetch`, since `ollama.com` is unreachable from this sandbox (`curl -sI` -> HTTP 403, same restriction that blocked Docker Hub earlier in the project) so no live Ollama server could be verified here. Tests cover: correct request shape (system message, converted tools), object-shaped and JSON-string-shaped tool arguments (Ollama's docs show the former, some models return the latter), a plain-text-only reply with no tool calls, a full round-trip of a prior tool_use + tool_result turn into Ollama's flat message shape, a descriptive thrown error on a non-OK response, and env-var defaults (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`) with trailing-slash handling. `LLM_PROVIDER=ollama` is now a third option alongside `fake` (still the zero-setup default) and `anthropic`; `.env.example` documents it, including the `ollama pull qwen2.5:7b` setup step. Typechecked clean and re-verified against your own machine's `tsc` too. Live verification is on you: you already have Ollama installed locally, so with `ollama serve` running and a tool-calling-capable model pulled, set `LLM_PROVIDER=ollama` (and optionally `OLLAMA_MODEL`) in `.env` and re-run a triage from the dashboard - the agent reasoning panel will show real model tool calls instead of the scripted fake ones.
12. **Landing page + navigation + visual refresh** - a real marketing-style landing page introducing the project and its purpose, a persistent nav bar (Dashboard, How It Works, Product Notes/About), and a visual tone pass on the existing dashboard's colors/typography, moving away from generic default-Tailwind toward something closer to a warm-clinical product feel. Scope explicitly confirmed: not a ground-up redesign of the dashboard's own layout/interaction patterns from §11 - the patient list and three-panel detail view stay as built underneath the new landing page/nav/visual pass.
13. **Product-gap narrative** - a "what I noticed on Legion Health's real site / how TriageCopilot addresses it" section, built from four concrete gaps identified in research (no visible crisis/safety escalation path, no visible audit trail or AI-disclosure UI, no visible intake/triage routing, no visible clinical co-pilot or chart-summarization surface), placed on the landing page and expanded into README (folding in task 9).

## 15. Mapping to the Legion Health JD

For your systems deep-dive prep - each JD bullet, answered by:

- *"Architect and scale our event-driven backend... clean state machines and event streams"* → §5, §7, §8 (`eventStore.ts`, `stateMachine.ts`).
- *"Build real LLM agents as coworkers... tool use, retries, memory, safety rails... evaluation loops"* → §9 (`agents/triageAgent.ts`, `agents/tools.ts`, `agents/llmProvider.ts`, `triageAgent.test.ts`).
- *"Shape human + AI ops UX... what happened, why, and what should happen next"* → §11 (the three-panel patient detail page).
- *"Define world-state & simulation... power alerting, routing, decision-making"* → §8 (`projectPatientState` as the single source of derived state; the defense-in-depth escalation is the "alerting" primitive).
- *"Own data, safety & compliance... PHI access, agent actions, and human overrides are all auditable"* → §7 event log (`actor_type` on every row) + §10 `/audit-log` endpoint. (With the explicit caveat from §3: this demonstrates the pattern, not real HIPAA compliance.)
