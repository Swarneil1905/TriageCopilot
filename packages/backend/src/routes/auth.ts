import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getPool } from "../db.js";
import {
  clearSessionCookie,
  getSessionUserId,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "../auth.js";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: "Validation error", details: issues });
}

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const pool = getPool();

  fastify.post("/auth/signup", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const { email, password } = parsed.data;

    const existing = await pool.query("select id from users where email = $1", [email]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: "An account with that email already exists" });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await pool.query(
      "insert into users (email, password_hash) values ($1, $2) returning id, email",
      [email, passwordHash]
    );
    const user = rows[0] as { id: string; email: string };
    setSessionCookie(reply, user.id);
    return reply.code(201).send({ email: user.email });
  });

  fastify.post("/auth/login", async (req, reply) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues);
    const { email, password } = parsed.data;

    const { rows } = await pool.query(
      "select id, email, password_hash from users where email = $1",
      [email]
    );
    const user = rows[0] as { id: string; email: string; password_hash: string } | undefined;
    // Deliberately identical error for "no such user" and "wrong password" --
    // distinguishing them lets an attacker enumerate registered emails.
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    setSessionCookie(reply, user.id);
    return reply.send({ email: user.email });
  });

  fastify.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  // Always 200, with { email: null } for "not logged in" -- this endpoint is
  // called on essentially every page load (NavBar, the landing page's live
  // demo section) to check session state, and for the large majority of
  // visitors to a public portfolio site that means "not logged in" is the
  // ordinary, expected case, not an error. Returning 401 for it used to
  // produce a "Failed to load resource: 401" line in the browser console on
  // every anonymous page view, which is exactly the kind of console noise
  // this project's own Playwright passes (see SPEC.md tasks 7/12) treat as
  // a bug -- caught while running scripts/verify-ui.mjs.
  fastify.get("/auth/me", async (req, reply) => {
    const userId = getSessionUserId(req);
    if (!userId) return reply.send({ email: null });

    const { rows } = await pool.query("select email from users where id = $1", [userId]);
    const user = rows[0] as { email: string } | undefined;
    if (!user) {
      // Session refers to a user that no longer exists (e.g. DB reset on
      // redeploy, since this demo Postgres has no persistent volume) --
      // treat it the same as logged-out rather than a 500.
      clearSessionCookie(reply);
      return reply.send({ email: null });
    }
    return reply.send({ email: user.email });
  });
};
