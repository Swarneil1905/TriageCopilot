import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { assertValidAppend, projectPatientState } from "./stateMachine.js";
import { ActorType, DomainEvent, EventType, PatientWorldState } from "./types.js";

function rowToEvent(row: any): DomainEvent {
  return {
    id: row.id,
    patientId: row.patient_id,
    runId: row.run_id,
    type: row.type,
    actorType: row.actor_type,
    actorName: row.actor_name,
    payload: row.payload,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export async function getEventsForPatient(pool: Pool, patientId: string): Promise<DomainEvent[]> {
  const { rows } = await pool.query(
    `select * from events where patient_id = $1 order by created_at asc`,
    [patientId]
  );
  return rows.map(rowToEvent);
}

export async function getPatientState(
  pool: Pool,
  patientId: string,
  displayName: string
): Promise<PatientWorldState> {
  const events = await getEventsForPatient(pool, patientId);
  return projectPatientState(patientId, displayName, events);
}

export interface AppendEventInput {
  patientId: string;
  runId?: string | null;
  type: EventType;
  actorType: ActorType;
  actorName: string;
  payload?: Record<string, unknown>;
}

/**
 * The single write path for the event log. Every append (or batch of
 * appends, see appendEvents below):
 *   1. reads the current event stream inside a transaction (SERIALIZABLE,
 *      so two concurrent writers for the same patient can't both pass the
 *      invariant check against a stale view),
 *   2. projects current state,
 *   3. asserts the new event is a legal transition,
 *   4. inserts it.
 *
 * This is the enforcement point for "invariants" from the JD -- callers
 * (routes, the agent orchestrator) can't bypass it; there is no other way
 * to write an event.
 */
export async function appendEvent(
  pool: Pool,
  displayNameLookup: (patientId: string) => Promise<string>,
  input: AppendEventInput
): Promise<DomainEvent> {
  const [event] = await appendEvents(pool, displayNameLookup, input.patientId, [input]);
  return event;
}

/**
 * Same write path as appendEvent, but for a batch of events that must land
 * atomically in one transaction -- each subsequent event in the batch is
 * validated against a state that already includes the earlier events in the
 * *same* batch, so the whole list either all lands or none of it does.
 *
 * This exists specifically so the triage agent orchestrator can write
 * TriageAgentCompleted + HumanReviewRequested as a single unit: the
 * defense-in-depth check in stateMachine.ts assumes those two events are
 * written together, and this is what actually makes that true rather than
 * just asserting it in a comment.
 */
export async function appendEvents(
  pool: Pool,
  displayNameLookup: (patientId: string) => Promise<string>,
  patientId: string,
  inputs: Array<Omit<AppendEventInput, "patientId">>
): Promise<DomainEvent[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const { rows } = await client.query(
      `select * from events where patient_id = $1 order by created_at asc for update`,
      [patientId]
    );
    let events = rows.map(rowToEvent);
    const displayName = await displayNameLookup(patientId);
    const inserted: DomainEvent[] = [];

    for (const input of inputs) {
      const currentState = projectPatientState(patientId, displayName, events);
      assertValidAppend(currentState, input.type, input.runId ?? null);

      const id = randomUUID();
      const insertRes = await client.query(
        `insert into events (id, patient_id, run_id, type, actor_type, actor_name, payload)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          id,
          patientId,
          input.runId ?? null,
          input.type,
          input.actorType,
          input.actorName,
          JSON.stringify(input.payload ?? {}),
        ]
      );
      const newEvent = rowToEvent(insertRes.rows[0]);
      inserted.push(newEvent);
      events = [...events, newEvent];
    }

    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createPatient(
  pool: Pool,
  displayName: string
): Promise<{ id: string }> {
  const { rows } = await pool.query(
    `insert into patients (display_name) values ($1) returning id`,
    [displayName]
  );
  const patientId = rows[0].id as string;
  await appendEvent(pool, async () => displayName, {
    patientId,
    type: "PatientCreated",
    actorType: "system",
    actorName: "intake-service",
    payload: {},
  });
  return { id: patientId };
}

export async function listPatientsWithState(pool: Pool): Promise<PatientWorldState[]> {
  const { rows } = await pool.query(`select id, display_name from patients order by created_at asc`);
  const states: PatientWorldState[] = [];
  for (const row of rows) {
    const events = await getEventsForPatient(pool, row.id);
    states.push(projectPatientState(row.id, row.display_name, events));
  }
  return states;
}

export async function getDisplayName(pool: Pool, patientId: string): Promise<string> {
  const { rows } = await pool.query(`select display_name from patients where id = $1`, [patientId]);
  if (rows.length === 0) throw new Error(`Patient ${patientId} not found`);
  return rows[0].display_name as string;
}
