import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getPool } from "../db.js";
import { createPatient, listPatientsWithState } from "../eventStore.js";
import { PgEventLog } from "../eventLog.js";
import { runTriageAgent } from "../agents/triageAgent.js";
import { makeLLMProvider } from "../agents/llmProvider.js";
import { requireAuth } from "../auth.js";
import { makeRequireQuota, recordAgentRun } from "../quota.js";

const createPatientSchema = z.object({
  display_name: z.string().min(1),
});

const intakeSchema = z.object({
  chief_complaint: z.string().min(1),
  phq9_score: z.number().optional(),
  gad7_score: z.number().optional(),
  free_text: z.string().optional(),
});

const clinicianDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "modified"]),
  note: z.string().optional(),
  clinician_name: z.string().min(1),
});

const scheduleFollowUpSchema = z.object({
  date: z.string().min(1),
  method: z.string().min(1),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: "Validation error", details: issues });
}

/** Validates :id is a well-formed UUID before it ever reaches a SQL query.
 * An unknown-but-valid UUID still 404s via PatientNotFoundError, but a
 * malformed one (typo, wrong resource, whatever) gets a clean 400 instead
 * of a raw Postgres "invalid input syntax for uuid" surfacing as a 500. */
function parseIdParam(req: { params: unknown }, reply: FastifyReply): string | null {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    badRequest(reply, parsed.error.issues);
    return null;
  }
  return parsed.data.id;
}

export const patientRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const pool = getPool();

  fastify.post("/patients", async (req, reply) => {
    const parsed = createPatientSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);

    const { id } = await createPatient(pool, parsed.data.display_name);
    const state = await new PgEventLog(pool, id).getState();
    return reply.code(201).send(state);
  });

  fastify.get("/patients", async () => {
    return listPatientsWithState(pool);
  });

  fastify.get<{ Params: { id: string } }>("/patients/:id", async (req, reply) => {
    const id = parseIdParam(req, reply);
    if (!id) return;
    return new PgEventLog(pool, id).getState();
  });

  fastify.get<{ Params: { id: string } }>("/patients/:id/audit-log", async (req, reply) => {
    const id = parseIdParam(req, reply);
    if (!id) return;
    const events = await new PgEventLog(pool, id).getHistory();
    return { patientId: id, events };
  });

  fastify.post<{ Params: { id: string } }>("/patients/:id/intake", async (req, reply) => {
    const id = parseIdParam(req, reply);
    if (!id) return;
    const parsed = intakeSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);

    const log = new PgEventLog(pool, id);
    await log.append({
      type: "IntakeFormSubmitted",
      actorType: "system",
      actorName: "intake-service",
      payload: parsed.data,
    });
    return log.getState();
  });

  // Auth-and-billing pass: this route now requires a session, its first
  // time ever requiring one. Patient data (list, individual records, the
  // audit log) stays exactly as open and unauthenticated as it has always
  // been; only this specific action changed, because it's the one that
  // costs real money once it's not on the free fake provider, and gating a
  // free-tier quota behind it requires knowing who is asking. See the
  // README's and SPEC.md's updated self-description for the full reasoning
  // behind this scope change.
  fastify.post<{ Params: { id: string } }>(
    "/patients/:id/run-triage",
    { preHandler: [requireAuth, makeRequireQuota(pool)] },
    async (req, reply) => {
      const id = parseIdParam(req, reply);
      if (!id) return;
      const log = new PgEventLog(pool, id);
      const provider = makeLLMProvider();
      // Blocks until the run completes, fails permanently, or hits the turn
      // cap: see triageAgent.ts for why every one of those exits still
      // leaves the patient in a reviewable (or explicitly escalated) state.
      const state = await runTriageAgent({ eventLog: log, provider });

      // Only counted after the run actually completed (successfully or via
      // its own internal escalation path, not a thrown error): a failed
      // request should never cost part of the caller's free allowance.
      const userId = (req as FastifyRequest & { userId: string }).userId;
      const email = (req as FastifyRequest & { userEmail: string }).userEmail;
      await recordAgentRun(pool, userId, email);

      return state;
    }
  );

  fastify.post<{ Params: { id: string } }>("/patients/:id/clinician-decision", async (req, reply) => {
    const id = parseIdParam(req, reply);
    if (!id) return;
    const parsed = clinicianDecisionSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);

    const log = new PgEventLog(pool, id);
    await log.append({
      type: "ClinicianDecisionRecorded",
      actorType: "clinician",
      actorName: parsed.data.clinician_name,
      payload: parsed.data,
    });
    return log.getState();
  });

  fastify.post<{ Params: { id: string } }>("/patients/:id/schedule-follow-up", async (req, reply) => {
    const id = parseIdParam(req, reply);
    if (!id) return;
    const parsed = scheduleFollowUpSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);

    const log = new PgEventLog(pool, id);
    await log.append({
      type: "FollowUpScheduled",
      actorType: "system",
      actorName: "scheduler",
      payload: parsed.data,
    });
    return log.getState();
  });
};
