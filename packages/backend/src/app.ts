import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { InvariantViolationError, PatientNotFoundError } from "./types.js";
import { patientRoutes } from "./routes/patients.js";

/**
 * Builds (but does not start) the Fastify app. Split out from server.ts so
 * tests can exercise real routes via fastify.inject() without binding a
 * network port.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true });

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof InvariantViolationError) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof PatientNotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    // Zod validation errors are already handled inline in the route
    // handlers (safeParse -> 400), so anything reaching here is either a
    // genuine bug or an infra problem (e.g. DB connection lost).
    req.log?.error?.(err);
    // eslint-disable-next-line no-console
    console.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  fastify.get("/health", async () => ({ ok: true }));
  await fastify.register(patientRoutes, { prefix: "/api" });

  return fastify;
}
