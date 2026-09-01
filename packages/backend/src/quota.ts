// The business gate for the AI triage agent: admin gets unlimited use, an
// active/trialing Stripe subscriber gets unlimited use, everyone else gets
// FREE_REQUEST_LIMIT lifetime agent runs before a 402 tells them to
// subscribe. This is deliberately separate from the abuse/bug protections
// already in routes/demo.ts (the per-account rate limit, the shared daily
// cap): those exist regardless of who's asking, even a paying subscriber
// shouldn't be able to accidentally script 1,000 runs in a minute, while
// this check is the actual product decision about who gets to use the
// feature at all. Both are layered, not one replacing the other.
//
// Built as a lifetime cap (ai_requests_used only ever goes up, never resets)
// rather than a monthly allowance, per the auth-billing prompt's own stated
// default. If a monthly reset turns out to be what was actually wanted, the
// prompt itself notes the variant: add an ai_requests_reset_at column, and
// have checkQuota zero the counter and roll the date forward when a check
// finds it's past due, before comparing against FREE_REQUEST_LIMIT. Confirm
// with the user before switching, since it's a real product behavior change,
// not just an implementation detail.
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { isAdminEmail } from "./admin.js";

export const FREE_REQUEST_LIMIT = 5;

export interface QuotaStatus {
  allowed: boolean;
  reason: "admin" | "subscribed" | "free_tier_remaining" | "free_tier_exhausted";
  requestsUsed: number;
  requestsRemaining: number | null; // null once subscribed/admin: "unlimited," not a number
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export async function checkQuota(pool: Pool, userId: string, email: string): Promise<QuotaStatus> {
  if (isAdminEmail(email)) {
    return { allowed: true, reason: "admin", requestsUsed: 0, requestsRemaining: null };
  }

  const { rows } = await pool.query(
    "select ai_requests_used, subscription_status from users where id = $1",
    [userId]
  );
  const row = rows[0] as { ai_requests_used: number; subscription_status: string | null } | undefined;
  const used = row?.ai_requests_used ?? 0;
  const subscribed = Boolean(row?.subscription_status && ACTIVE_STATUSES.has(row.subscription_status));

  if (subscribed) {
    return { allowed: true, reason: "subscribed", requestsUsed: used, requestsRemaining: null };
  }
  if (used < FREE_REQUEST_LIMIT) {
    return {
      allowed: true,
      reason: "free_tier_remaining",
      requestsUsed: used,
      requestsRemaining: FREE_REQUEST_LIMIT - used,
    };
  }
  return { allowed: false, reason: "free_tier_exhausted", requestsUsed: used, requestsRemaining: 0 };
}

/** Call this only after a real agent run actually happened: never on a
 * rejected/failed request, and never for an admin (nothing to count). */
export async function recordAgentRun(pool: Pool, userId: string, email: string): Promise<void> {
  if (isAdminEmail(email)) return;
  await pool.query("update users set ai_requests_used = ai_requests_used + 1 where id = $1", [userId]);
}

/** Fastify preHandler factory, meant to run right after requireAuth (so
 * req.userId is already set). Looks up that user's own email from the
 * database (never trusts a client-supplied header/body field, matching the
 * same discipline as isAdminEmail), runs checkQuota, and sends a 402 if
 * it's not allowed. On success, attaches req.userEmail so the route handler
 * can call recordAgentRun afterward without a second lookup. Shared by both
 * routes/patients.ts (run-triage) and routes/demo.ts (demo/run) so the two
 * gates can never drift out of sync with each other. */
export function makeRequireQuota(pool: Pool) {
  return async function requireQuota(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = (req as FastifyRequest & { userId: string }).userId;
    const { rows } = await pool.query("select email from users where id = $1", [userId]);
    const email = (rows[0] as { email: string } | undefined)?.email;
    if (!email) {
      reply.code(401).send({ error: "Login required" });
      return;
    }

    const quota = await checkQuota(pool, userId, email);
    if (!quota.allowed) {
      reply.code(402).send({
        error: "You've used all 5 free triage runs. Subscribe for unlimited access.",
        quota,
      });
      return;
    }

    (req as FastifyRequest & { userEmail: string }).userEmail = email;
  };
}
