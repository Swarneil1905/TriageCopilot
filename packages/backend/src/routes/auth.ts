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
import { requireTrustedOrigin } from "../security.js";
import { isAdminEmail } from "../admin.js";
import { FREE_REQUEST_LIMIT } from "../quota.js";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function badRequest(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({ error: "Validation error", details: issues });
}

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const pool = getPool();

  fastify.post(
    "/auth/signup",
    {
      preHandler: requireTrustedOrigin,
      config: {
        // Security hardening pass, finding 2: scrypt is deliberately CPU
        // expensive (that's what makes it a good password hash), which
        // makes an unthrottled signup endpoint a CPU-exhaustion vector as
        // much as an account-creation one. Per-IP (the default
        // keyGenerator) is right here, unlike /demo/run's per-account
        // limit: there's no session yet at this point in the request.
        rateLimit: { max: 8, timeWindow: "15 minutes" },
      },
    },
    async (req, reply) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error.issues);
      const { email, password } = parsed.data;

      // Security hardening pass, finding 7: this select-then-insert has a
      // real race (two concurrent signups for the same email can both pass
      // this check before either insert runs). The database's own
      // `email ... unique` constraint (migration 0002) means this can
      // never actually create two accounts with the same email, but
      // without the try/catch below the loser's insert would surface as a
      // raw, unhandled 500 instead of the intended 409. Kept the upfront
      // select too (not just the catch): it's what gives almost every real
      // signup attempt a clean 409 without ever touching scryptSync, and
      // the catch is the correctness backstop for the rare concurrent case,
      // not a replacement for it.
      const existing = await pool.query("select id from users where email = $1", [email]);
      if (existing.rows.length > 0) {
        return reply.code(409).send({ error: "An account with that email already exists" });
      }

      const passwordHash = hashPassword(password);
      try {
        const { rows } = await pool.query(
          "insert into users (email, password_hash) values ($1, $2) returning id, email",
          [email, passwordHash]
        );
        const user = rows[0] as { id: string; email: string };
        setSessionCookie(reply, user.id);
        return reply.code(201).send({ email: user.email });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "An account with that email already exists" });
        }
        throw err;
      }
    }
  );

  fastify.post(
    "/auth/login",
    {
      preHandler: requireTrustedOrigin,
      // Security hardening pass, finding 2: nothing previously stopped an
      // automated credential-stuffing or brute-force script from attempting
      // unlimited password guesses against any known email. Per-IP, same
      // reasoning as signup above.
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (req, reply) => {
      const parsed = credentialsSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(reply, parsed.error.issues);
      const { email, password } = parsed.data;

      const { rows } = await pool.query(
        "select id, email, password_hash from users where email = $1",
        [email]
      );
      const user = rows[0] as { id: string; email: string; password_hash: string } | undefined;
      // Deliberately identical error for "no such user" and "wrong password":
      // distinguishing them lets an attacker enumerate registered emails.
      if (!user || !verifyPassword(password, user.password_hash)) {
        return reply.code(401).send({ error: "Invalid email or password" });
      }

      setSessionCookie(reply, user.id);
      return reply.send({ email: user.email });
    }
  );

  fastify.post("/auth/logout", { preHandler: requireTrustedOrigin }, async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  // Always 200, with { email: null } for "not logged in": this endpoint is
  // called on essentially every page load (NavBar, the landing page's live
  // demo section) to check session state, and for the large majority of
  // visitors to a public portfolio site that means "not logged in" is the
  // ordinary, expected case, not an error. Returning 401 for it used to
  // produce a "Failed to load resource: 401" line in the browser console on
  // every anonymous page view, which is exactly the kind of console noise
  // this project's own Playwright passes (see SPEC.md tasks 7/12) treat as
  // a bug, caught while running scripts/verify-ui.mjs.
  fastify.get("/auth/me", async (req, reply) => {
    const userId = getSessionUserId(req);
    if (!userId) return reply.send({ email: null });

    // Auth-and-billing pass: extended with everything the frontend needs to
    // render admin/subscribed/free-tier state in one call (NavBar's usage
    // chip, the /billing page, the 402 branches in ActionPanel and
    // LiveDemoRunner), rather than a second round trip. Purely additive:
    // every existing consumer (SessionProvider, NavBar) only ever read
    // .email, so this changes nothing for them.
    const { rows } = await pool.query(
      "select email, ai_requests_used, subscription_status from users where id = $1",
      [userId]
    );
    const user = rows[0] as
      | { email: string; ai_requests_used: number; subscription_status: string | null }
      | undefined;
    if (!user) {
      // Session refers to a user that no longer exists (e.g. DB reset on
      // redeploy, since this demo Postgres has no persistent volume);
      // treat it the same as logged-out rather than a 500.
      clearSessionCookie(reply);
      return reply.send({ email: null });
    }

    const admin = isAdminEmail(user.email);
    const subscribed = Boolean(
      user.subscription_status && ACTIVE_SUBSCRIPTION_STATUSES.has(user.subscription_status)
    );

    return reply.send({
      email: user.email,
      isAdmin: admin,
      isSubscribed: subscribed,
      requestsUsed: user.ai_requests_used,
      requestsRemaining: admin || subscribed ? null : Math.max(0, FREE_REQUEST_LIMIT - user.ai_requests_used),
    });
  });
};
