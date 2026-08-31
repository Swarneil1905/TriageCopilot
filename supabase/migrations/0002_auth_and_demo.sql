-- TriageCopilot: adds a real (if intentionally minimal) login system and the
-- schema needed for a public "watch the AI agent reason live" demo trigger on
-- the landing page.
--
-- Why login exists at all in an otherwise-unauthenticated portfolio demo: the
-- live demo trigger makes a real LLM call on every click. Once LLM_PROVIDER
-- is pointed at a real hosted model, an anonymous, un-gated button like that
-- is a standing invitation to run up the API bill. Requiring an account is
-- the cheapest real guardrail against that, on top of the rate limiting and
-- daily cap enforced in application code (see routes/demo.ts). This is
-- explicitly a cost/abuse gate, not a real access-control system -- there is
-- still no session-based authorization anywhere else in the app (patient
-- data, the dashboard, and every existing route stay exactly as open as they
-- always were).
--
-- Same idempotency convention as 0001_init.sql: safe to re-run on every
-- deploy.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Flags patients created by the public live-demo button rather than the seed
-- script or a real intake, so the main dashboard list (and the landing
-- page's "N synthetic patients" count) can exclude the ephemeral ones by
-- default without losing them -- a demo patient is still a completely real
-- row in the same event-sourced schema, still viewable at its own
-- /patients/:id page, just filtered out of the default listing.
alter table patients add column if not exists is_demo boolean not null default false;

-- One row per live-demo run. Exists purely so the daily cap in routes/demo.ts
-- has something durable to count against (an in-memory counter would reset
-- on every redeploy, and this Postgres already has no persistent volume per
-- the known limitation documented for task 10 -- so in practice this table's
-- rows don't outlive a redeploy either, but it does survive process
-- restarts/crashes within a deploy, which an in-memory counter would not).
create table if not exists demo_runs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists demo_runs_created_at_idx on demo_runs (created_at);
