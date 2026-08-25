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
 * The single write path for the event log. Every append:
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const { rows } = await client.query(
      `select * from events where patient_id = $1 order by created_at asc for update`,
      [input.patientId]
    );
    const events = rows.map(rowToEvent);
    const displayName = await displayNameLookup(input.patientId);
    const currentState = projectPatientState(input.patientId, displayName, events);

    assertValidAppend(currentState, input.type, input.runId ?? null);

    const id = randomUUID();
    const insertRes = await client.query(
      `insert into events (id, patient_id, run_id, type, actor_type, actor_name, payload)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        id,
        input.patientId,
        input.runId ?? null,
        input.type,
        input.actorType,
        input.actorName,
        JSON.stringify(input.payload ?? {}),
      ]
    );

    await client.query("COMMIT");
    return rowToEvent(insertRes.rows[0]);
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
