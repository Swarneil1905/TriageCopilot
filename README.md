# TriageCopilot

[![CI](https://github.com/Swarneil1905/TriageCopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/Swarneil1905/TriageCopilot/actions/workflows/ci.yml)

An event-sourced care-ops prototype where an LLM triage agent works a synthetic patient's
intake end to end, tool call by tool call, then is **architecturally incapable of closing the
loop itself** - every run ends in a `request_human_review` handoff to a clinician.

> **Synthetic demo data only.** No real patients, no real PHI, no real diagnoses or prescribing
> logic. Every patient in this repo is fictional and labeled as such in the UI. This is not
> HIPAA-compliant software and is not connected to any real EHR - see [What this explicitly
> isn't](#what-this-explicitly-isnt).

**Live demo:** https://frontend-production-5a1c9.up.railway.app (backend API at
https://backend-production-22343.up.railway.app/api). Runs on `LLM_PROVIDER=fake` for a
zero-cost, zero-API-key public demo - see [How to run locally](#how-to-run-locally) below to
point it at a real Anthropic or local Ollama model instead. The demo Postgres has no persistent
volume attached, so seeded data resets on redeploy; that's an accepted tradeoff given the data
is synthetic by design, not an oversight. The landing page's "Watch the AI agent reason" section
lets you create an account and trigger a real triage-agent run yourself, live, against whatever
model is currently configured - see below.

## What this is

The point isn't a chatbot with a nice UI bolted on. It's four architectural bets, each one
enforced in code rather than promised in a prompt:

- **Events are the only source of truth.** A patient's status, risk level, and every agent/
  clinician action is a pure fold over an append-only event log, not a mutable row.
- **The agent can't finalize anything, structurally.** The system prompt asks the model to
  always hand off to a clinician. It doesn't matter whether it complies - the orchestrator
  writes the completion + human-review events itself, every single run.
- **Failure escalates instead of disappearing.** A flaky LLM call retries with backoff; if it
  never recovers, the patient is forced into `urgent_review` rather than left in limbo. A second,
  independent check catches the rarer case where the safety event itself failed to write.
- **The model is swappable.** The agent talks to an `LLMProvider` interface, not a vendor SDK.
  Ship with zero setup on a deterministic fake, point it at Anthropic for a hosted model, or run
  it entirely against a local Ollama model with nothing leaving your machine.

## Watch the AI agent reason

The landing page doesn't just describe the architecture in prose - it embeds a real, already-
completed patient's actual `TriageToolCalled` trace (not a screenshot or a mockup), and below it
a "Run a live triage now" button that creates a fresh synthetic patient and runs the real agent
against it, live, rendering the trace inline as soon as it completes.

That button, and now also running a real triage on any patient from its own page, both require a
real (if intentionally minimal) account: a password is scrypt-hashed, or sign in with Google
instead, and either way a session is an HMAC-signed cookie. Every new account gets 5 free
triage-agent runs for life, then a $19.99/month Stripe subscription for unlimited runs. The site
owner's own account (configured via `ADMIN_EMAILS`) always has unlimited access at no cost. On
top of that quota, the live-demo endpoint specifically also stays rate-limited per account (5
runs per 15 minutes) plus a shared daily cap across every account (`DEMO_DAILY_CAP`, default 20).

This is a real change from an earlier version of this project, stated plainly rather than routed
around quietly: triggering a real triage run used to be open to anyone, with no login at all. It
now requires one, because gating a free tier behind a subscription means knowing who is asking.
Everything else in this app (the dashboard, every patient's record, the audit log) has never
required login and still doesn't; that part is unchanged. The underlying reason is the same one
that motivated the original login gate: an anonymous, ungated action that makes a real LLM call
is a standing invitation to run up the site owner's API bill once `LLM_PROVIDER` points at a
hosted model, and now that action can cost the user their own money too, once they are past the
free tier. See `0002_auth_and_demo.sql` and `0003_billing_and_oauth.sql`'s header comments for
the full reasoning.

## Architecture

```mermaid
flowchart LR
    subgraph Client
        UI[Next.js dashboard]
    end

    subgraph Backend[Node/TS backend]
        API[Fastify REST API]
        SM[State machine\n(pure projection + invariants)]
        ES[Event store\n(append-only, transactional)]
        AG[Triage agent orchestrator]
        TOOLS[Agent tools]
        LLM[LLM provider\n(Fake | Anthropic | Ollama)]
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

Every write goes through one function, `eventStore.appendEvent`, which - inside a
`SERIALIZABLE` transaction - re-projects the patient's current state, checks the proposed event
against the state machine's invariants, and only then inserts. An illegal transition (a
clinician decision recorded before any triage ran, a follow-up scheduled twice) is rejected at
that layer with a `409`, not just hidden in the UI - call the API directly and you still get
rejected.

The triage agent gets four tools: look up prior history, flag a risk level, draft a clinical
summary, and request human review. Every tool call is logged as its own `TriageToolCalled`
event with input and output, in order - that log is exactly what the dashboard's Agent
Reasoning panel renders, so a clinician can see precisely what produced a recommendation, not
just the recommendation itself.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend runtime | Node.js + TypeScript | A common, production-grade choice for a typed backend. |
| DB | Postgres via Supabase-style migrations (`supabase/migrations/`), local dev via `docker-compose` | Same schema you'd hand to a real Supabase project unchanged. |
| API framework | Fastify | Lightweight, fast to reason about, first-class TS support. |
| LLM providers | `FakeProvider` (deterministic, zero setup) · `AnthropicProvider` (`@anthropic-ai/sdk`, tool-calling) · `OllamaProvider` (native `/api/chat` tool-calling against a local model) | The whole demo, meaning seed data, all 77 backend tests, and the UI, runs with zero API key and zero network calls on `FakeProvider`. Flip `LLM_PROVIDER` to see either a hosted or fully local live agent. |
| Frontend | Next.js 15 (App Router) + Tailwind v4 | A common, modern choice for a React frontend. |
| Tests | Vitest | Fast, good TS support, minimal config. |
| Login | scrypt-hashed passwords or Google sign-in (`@fastify/oauth2`), plus an HMAC-signed session cookie (`@fastify/cookie`, `node:crypto`, no third-party auth service beyond Google itself) | Gates real triage-agent runs (the live demo and any patient's own run-triage action) behind a free-tier-then-subscription quota, not a general access-control layer; see [Watch the AI agent reason](#watch-the-ai-agent-reason). |
| Billing | Stripe Checkout + Billing Portal (hosted; no card details ever touch this app) | $19.99/month for unlimited triage-agent runs once the 5 free lifetime runs are used; the site owner is exempt via `ADMIN_EMAILS`. |
| Abuse protection | `@fastify/rate-limit` (per-account) + a Postgres-backed daily cap | Protects the site owner's LLM API spend on the live-demo endpoint specifically, layered on top of, not instead of, the free-tier quota above. |

## How to run locally

```bash
cp .env.example .env
docker compose up -d db        # local Postgres, migrations auto-applied
npm install
npm run backend:test           # 77 tests, LLM_PROVIDER=fake, no API key needed
npm run backend:seed           # populates 4 synthetic patients
npm run backend:dev            # API on :4000
npm run frontend:dev           # dashboard on :3000
```

Then visit `localhost:3000` for the landing page, or `localhost:3000/dashboard` directly for
the patient list.

To see a **live** tool-calling agent instead of the scripted fake one, set in `.env`:

- `LLM_PROVIDER=anthropic` + a real `ANTHROPIC_API_KEY`, or
- `LLM_PROVIDER=ollama` with [Ollama](https://ollama.com) running locally and a tool-calling
  model pulled (`ollama pull qwen2.5:7b` is the default `OLLAMA_MODEL`) - nothing leaves your
  machine.

## Testing strategy

- `stateMachine.test.ts` (12 tests) - every invariant has at least one test proving a violating
  append throws, over hand-built event sequences. Pure, no DB required.
- `tools.test.ts` (6 tests) - tool execution and the risk-level extraction helper.
- `triageAgent.test.ts` (6 tests) - the orchestrator forces a human handoff even when the model
  skips `request_human_review`; a failure-then-recover run logs one `AgentErrorOccurred` and
  still completes; a permanent-failure run ends in `urgent_review` with a `safetyAlert`.
- `llmProvider.test.ts` (3 tests) + `ollamaProvider.test.ts` (8 tests) - `FakeProvider`'s
  scripting behavior, and `OllamaProvider`'s request/response shape against a mocked `fetch`
  (no live Ollama server needed to verify the adapter logic).
- `api.test.ts` (5 tests) - a full patient journey through the real HTTP API against real
  Postgres: create → intake → triage → clinician approval → follow-up, asserting status and
  HTTP codes at every step.
- `auth.test.ts` (6 tests) - signup/login/logout against real Postgres: duplicate-email
  rejection, wrong-password rejection, a session cookie surviving a real request/response round
  trip, and `/auth/me` reading `email: null` (200, not 401 - see the comment on that route) for
  no session or a garbage one.
- `demo.test.ts` (5 tests) - the live-demo trigger requires login; a real (fake-provider) triage
  run against a fresh demo patient still ends in a reviewable status; demo patients are excluded
  from the main dashboard listing but stay directly reachable at their own page; the daily cap
  and the per-account rate limit both actually reject once hit, computed against whatever is
  already in `demo_runs` today rather than assuming a clean table, so this doesn't flake as the
  shared dev Postgres accumulates rows.
- `quota.test.ts` (5 tests): the admin allowlist bypasses the free-tier quota entirely and never
  increments `ai_requests_used`; a free-tier account gets exactly `FREE_REQUEST_LIMIT` successful
  runs on `run-triage`, then a 402 with quota detail; the same holds for `/demo/run`, and a 402
  wins over that endpoint's own 429 rate limit when both would trigger on the same request; a
  failed run-triage attempt never consumes any of the allowance; an active subscription allows
  unlimited runs.
- `billing.test.ts` (7 tests): `/billing/checkout` and `/billing/portal` both require login and
  both return a clean 503 (not a crash) when Stripe isn't configured, matching this test
  environment; the webhook route rejects a missing or tampered signature; a genuinely signed
  (via the Stripe SDK's own test helper, never a hand-rolled signature) `checkout.session.completed`
  event activates a subscription, and a `customer.subscription.deleted` event cancels one.
- `oauth.test.ts` (5 tests): the Google account-linking guardrail, tested directly against real
  Postgres and bypassing the actual OAuth network exchange, since none of that logic needs it. A
  new email creates a Google-only account with no `password_hash`; an existing password account
  with no linked `google_id` yet is refused, never silently merged; a repeat sign-in with an
  already-linked `google_id` logs in cleanly with no duplicate row created; an unverified Google
  email is refused outright; `/auth/google` itself returns a clean 503 when Google sign-in isn't
  configured.
- `scripts/smoke.ts` - a manual, real-Postgres end-to-end smoke test including a deliberately
  rejected premature follow-up, to prove the invariant layer rejects bad writes even from
  legitimate-looking API calls.

**77/77 passing.**

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request against `main`: `npm ci`, the
full backend suite against a real (freshly-provisioned, CI-only) Postgres, a backend typecheck,
and a production frontend build. Deliberately separate from Railway's own deploy: Railway builds
and ships whatever lands on `main` regardless of whether it's any good, so this is the actual
quality gate, not just a deploy trigger. Needs zero secrets and makes zero external API calls -
`LLM_PROVIDER` stays at its zero-cost fake default in CI, same as every other zero-setup path in
this repo - so a fork or a PR from anyone can run it without your credentials.

## What I noticed, and how this answers it

Before building this, I read through how a handful of companies actually shipping AI into
clinical workflows (Abridge, Corti, Suki, Nabla) publicly describe their architecture and
safety posture. A consistent thread: none of them are pitching an autonomous AI doctor. The
framing that keeps showing up is closer to what's been called a "Tesla model": a human clinician
always in the loop, AI absorbing operational and administrative load incrementally. That's the
model this project is built around, not a caricature of "AI replaces clinicians."

Four gaps I noticed in how this space usually presents itself, and what answers each one here:

1. **No visible crisis or safety-escalation path.** A high-risk flag routes straight to
   `urgent_review`, and - independently - if a completed triage run is ever missing its
   human-review handoff event, the state machine treats that as a safety failure on its own and
   escalates anyway.
2. **No visible audit trail or AI-disclosure UI.** The Agent Reasoning panel is the literal,
   ordered sequence of tool calls behind a run - the same idea in spirit as Abridge's "Linked
   Evidence" pattern: click into a case, see exactly what produced the recommendation.
3. **No visible intake or triage-routing logic.** Patient status is a state machine, not a field
   you can set - nine statuses, explicit legal transitions, enforced in the same transaction
   that writes the event.
4. **No visible clinical co-pilot or documentation surface.** `draft_clinical_summary` produces
   exactly that: a draft, never shown to the patient or auto-applied, that a clinician reviews,
   edits, or rejects.

### What I'd add at production scale

- **A real evaluation suite** - adversarial cases, boundary cases, a held-out "should this
  escalate" set, run against every new model or prompt version, closer to how Abridge describes
  silent-release testing with partner health systems.
- **A second-pass check before handoff** - an evaluator-optimizer step verifying the drafted
  summary doesn't contradict the flagged risk level, before a human ever sees it.
- **Durable execution instead of hand-rolled retries** - the retry/backoff + event log here is
  functionally a hand-rolled version of what Temporal or LangGraph's checkpointer pattern give
  out of the box: crash recovery, resumable state, a built-in audit log.
- **Per-run tracing** - Langfuse/LangSmith-style observability keyed off the `runId` every event
  already carries, to answer "how much did this cost, how long did it take" alongside "what
  happened."

### What this explicitly isn't

Role-based access control, encryption at rest and in transit, a signed BAA, an actual HIPAA
compliance program, a connection to a real EHR. None of that is simulated here, named directly
rather than glossed over. The real auth and billing system that does exist (password or Google
login, a free-tier-then-Stripe-subscription quota on real triage-agent runs, an admin allowlist
for the site owner, see [Watch the AI agent reason](#watch-the-ai-agent-reason)) is there purely
to protect the site owner's API spend and let the app charge for its own real usage, not as a
stand-in for the access-control layer a real clinical system would need: it grants no clinical
permissions and checks no clinical roles. Patient data itself, meaning the dashboard, every
patient's record, and the audit log, is exactly as open and unauthenticated as it has always
been; the one thing that changed with this pass is which specific action requires an account.
Previously that was only the live-demo button; now triggering a real triage-agent run on any
patient requires one too, for the same reason: it is the action that costs real money once it is
not on the scripted fake provider.

## License

MIT - see [LICENSE](LICENSE).
