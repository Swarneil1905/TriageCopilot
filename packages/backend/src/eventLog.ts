import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { appendEvent, appendEvents, getDisplayName, getEventsForPatient, getPatientState } from "./eventStore.js";
import { assertValidAppend, projectPatientState } from "./stateMachine.js";
import { ActorType, DomainEvent, EventType, PatientWorldState } from "./types.js";

export interface EventLogAppendInput {
  runId?: string | null;
  type: EventType;
  actorType: ActorType;
  actorName: string;
  payload?: Record<string, unknown>;
}

/**
 * A patient-scoped write/read port. The triage agent orchestrator depends on
 * this interface, not on Postgres directly -- that's what lets
 * triageAgent.test.ts exercise the real retry/escalation/forced-handoff
 * logic (including real invariant enforcement) without a database, via
 * InMemoryEventLog below. PgEventLog is the adapter routes actually use.
 */
export interface EventLog {
  append(input: EventLogAppendInput): Promise<DomainEvent>;
  appendMany(inputs: EventLogAppendInput[]): Promise<DomainEvent[]>;
  getHistory(): Promise<DomainEvent[]>;
  getState(): Promise<PatientWorldState>;
}

export class PgEventLog implements EventLog {
  constructor(private pool: Pool, private patientId: string) {}

  private nameOf = (id: string) => getDisplayName(this.pool, id);

  async append(input: EventLogAppendInput): Promise<DomainEvent> {
    return appendEvent(this.pool, this.nameOf, { ...input, patientId: this.patientId });
  }

  async appendMany(inputs: EventLogAppendInput[]): Promise<DomainEvent[]> {
    return appendEvents(this.pool, this.nameOf, this.patientId, inputs);
  }

  async getHistory(): Promise<DomainEvent[]> {
    return getEventsForPatient(this.pool, this.patientId);
  }

  async getState(): Promise<PatientWorldState> {
    const displayName = await this.nameOf(this.patientId);
    return getPatientState(this.pool, this.patientId, displayName);
  }
}

/**
 * In-memory adapter for tests: same invariant enforcement (assertValidAppend)
 * and the same projection (projectPatientState) as production, just backed
 * by a plain array instead of a transaction. A monotonic counter stands in
 * for real timestamps so ordering is deterministic regardless of how fast
 * the test runs.
 */
export class InMemoryEventLog implements EventLog {
  private events: DomainEvent[] = [];
  private clockMs = Date.parse("2026-01-01T00:00:00.000Z");

  constructor(private patientId: string, private displayName: string, seedEvents: DomainEvent[] = []) {
    this.events = [...seedEvents];
  }

  private currentState(): PatientWorldState {
    return projectPatientState(this.patientId, this.displayName, this.events);
  }

  async append(input: EventLogAppendInput): Promise<DomainEvent> {
    const state = this.currentState();
    assertValidAppend(state, input.type, input.runId ?? null);

    const event: DomainEvent = {
      id: randomUUID(),
      patientId: this.patientId,
      runId: input.runId ?? null,
      type: input.type,
      actorType: input.actorType,
      actorName: input.actorName,
      payload: input.payload ?? {},
      createdAt: new Date(this.clockMs++).toISOString(),
    };
    this.events.push(event);
    return event;
  }

  async appendMany(inputs: EventLogAppendInput[]): Promise<DomainEvent[]> {
    const inserted: DomainEvent[] = [];
    for (const input of inputs) {
      inserted.push(await this.append(input));
    }
    return inserted;
  }

  async getHistory(): Promise<DomainEvent[]> {
    return [...this.events];
  }

  async getState(): Promise<PatientWorldState> {
    return this.currentState();
  }
}
