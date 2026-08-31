import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { InvariantViolationError, PatientNotFoundError } from "./types.js";
import { patientRoutes } from "./routes/patients.js";
import { authRoutes } from "./routes/auth.js";
import { demoRoutes } from "./routes/demo.js";

/**
 * Builds (but does not start) the Fastify app. Split out from server.ts so
 * tests can exercise real routes via fastify.inject() without binding a
 * network port.
 */
export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });

  await fastify.register(cors, { origin: true, credentials: true });
  await fastify.register(cookie);
  // Global registration is required by @fastify/rate-limit even though only
  // the /api/demo routes opt into an actual limit (config: false everywhere
  // else) -- see routes/demo.ts for the real per-route config.
  await fastify.register(rateLimit, { global: false });

  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof InvariantViolationError) {
      return reply.code(409).send({ error: err.message });
    }
    if (err instanceof PatientNotFoundError) {
      return reply.code(404).send({ error: err.message });
    }
    // Plugins that throw rather than reply directly (e.g. @fastify/rate-limit
    // on a 429) attach their own intended statusCode to the error -- respect
    // it instead of collapsing every thrown error to a 500. This was a real
    // bug caught by demo.test.ts's rate-limit test: without this check, a
    // legitimate 429 from the rate limiter surfaced to the client as a 500.
    const errWithStatus = err as Error & { statusCode?: unknown };
    if (
      typeof errWithStatus.statusCode === "number" &&
      errWithStatus.statusCode >= 400 &&
      errWithStatus.statusCode < 500
    ) {
      return reply.code(errWithStatus.statusCode).send({ error: errWithStatus.message });
    }
    // Zod validation errors are already handled inline in the route
    // handlers (safeParse -> 400), so anything reaching here is either a
    // genuine bug or an infra problem (e.g. DB connection lost).
    req.log?.error?.(err);
    // eslint-disable-next-line no-console
    console.error(err);
    return reply.code(500).send({ error: "Internal server error" });
  });

  fastify.get("/health", async () => ({
    ok: true,
    llmProvider: process.env.LLM_PROVIDER ?? "fake",
  }));
  await fastify.register(patientRoutes, { prefix: "/api" });
  await fastify.register(authRoutes, { prefix: "/api" });
  await fastify.register(demoRoutes, { prefix: "/api" });

  return fastify;
}
