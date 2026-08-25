-- TriageCopilot: event-sourced patient journey schema.
-- Design: the `events` table is the single source of truth (append-only).
-- `patients` holds only identity/demographic fields that never change via
-- the state machine; everything about a patient's *journey* is a fold over
-- their events. This mirrors "world-state & simulation" from the JD: you can
-- reconstruct the canonical state of any patient at any point in time by
-- replaying events up to a timestamp.

create extension if not exists "pgcrypto";

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  synthetic boolean not null default true, -- always true in this demo; real
                                            -- system would gate PHI-bearing
                                            -- rows behind row-level security
  created_at timestamptz not null default now()
);

-- Append-only event log. No updates, no deletes, in application code.
-- `actor_type` is the core audit primitive the JD calls out: every action
-- is attributable to system / agent / clinician, never ambiguous.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  run_id uuid, -- groups all events emitted by one agent invocation
  type text not null,
  actor_type text not null check (actor_type in ('system', 'agent', 'clinician')),
  actor_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_patient_id_created_at_idx
  on events (patient_id, created_at);

create index if not exists events_run_id_idx
  on events (run_id);

-- Convenience view: latest event per patient, useful for dashboard list
-- queries without pulling the full event stream.
create or replace view patient_latest_event as
  select distinct on (patient_id)
    patient_id, id as event_id, type, actor_type, actor_name, payload, created_at
  from events
  order by patient_id, created_at desc;
