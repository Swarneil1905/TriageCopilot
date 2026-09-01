import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { getPool } from "../db.js";
import { createDemoPatient } from "../eventStore.js";
import { PgEventLog } from "../eventLog.js";
import { runTriageAgent } from "../agents/triageAgent.js";
import { makeLLMProvider } from "../agents/llmProvider.js";
import { requireAuth } from "../auth.js";
import { requireTrustedOrigin } from "../security.js";

// A handful of fictional, varied intake scenarios for the public live-demo
// button. Picked at random per click so repeat visits don't all look
// identical, though note that with LLM_PROVIDER=fake (the zero-cost
// public default) the *agent's* response is still the same scripted output
// regardless of which one is picked, same as every other route on this
// fake provider; only once LLM_PROVIDER=anthropic or =ollama is live does
// the model actually reason differently per scenario, which is the entire
// point of this feature.
const DEMO_SCENARIOS = [
  {
    label: "mild and situational",
    chief_complaint: "Feeling low and unmotivated for the past few weeks, some trouble sleeping.",
    phq9_score: 8,
    gad7_score: 5,
  },
  {
    label: "work stress and irritability",
    chief_complaint: "Increased irritability and racing thoughts before an upcoming work deadline.",
    phq9_score: 6,
    gad7_score: 9,
  },
  {
    label: "grief and low mood",
    chief_complaint: "Persistent low mood and low energy since a recent family loss two months ago.",
    phq9_score: 11,
    gad7_score: 7,
  },
] as const;

function pickScenario() {
  return DEMO_SCENARIOS[Math.floor(Math.random() * DEMO_SCENARIOS.length)];
}

/** Simple durable daily cap, backed by the demo_runs table (see 0002 migration's
 * comment on why an in-memory counter isn't the right primitive here). Configurable
 * via DEMO_DAILY_CAP so the limit can be tuned without a code change. */
async function dailyCapRemaining(pool: import("pg").Pool): Promise<number> {
  const cap = Number(process.env.DEMO_DAILY_CAP ?? 20);
  const { rows } = await pool.query(
    `select count(*)::int as count from demo_runs where created_at >= date_trunc('day', now() at time zone 'utc')`
  );
  const used = (rows[0]?.count as number) ?? 0;
  return Math.max(0, cap - used);
}

export const demoRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const pool = getPool();

  fastify.post(
    "/demo/run",
    {
      // Security hardening pass, finding 3: fixing CORS (finding 1) stops a
      // malicious page's JavaScript from reading this route's response, but
      // not the browser from sending the cookie-bearing request in the
      // first place. And for this specific route, the attacker doesn't
      // need to read the response for the attack to matter: the LLM call
      // and the cost/quota consumption already happened by the time the
      // (blocked) response would arrive. requireTrustedOrigin runs first,
      // so an untrusted cross-origin request never even reaches the auth
      // check below.
      preHandler: [requireTrustedOrigin, requireAuth],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
          // @fastify/rate-limit defaults to an onRequest hook, which runs
          // before this route's own preHandler (requireAuth). Forcing it
          // to run as a preHandler instead means req.userId (set by
          // requireAuth) is already available when keyGenerator runs, so
          // the quota is genuinely per-account rather than falling back to
          // per-IP for every request because auth hadn't happened yet.
          hook: "preHandler",
          // Rate limit per logged-in user, not per IP: several visitors
          // behind the same NAT/office IP shouldn't share one quota, and a
          // logged-in user id is a more meaningful identity here anyway.
          keyGenerator: (req) => (req as typeof req & { userId?: string }).userId ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const remaining = await dailyCapRemaining(pool);
      if (remaining <= 0) {
        return reply.code(429).send({
          error:
            "The live demo has hit its shared daily limit (protects the site owner's API budget). Please check back tomorrow, or explore the seeded patients on the dashboard instead.",
        });
      }

      const scenario = pickScenario();
      const { id } = await createDemoPatient(pool, `Live Demo Patient (${scenario.label})`);
      const log = new PgEventLog(pool, id);

      await log.append({
        type: "IntakeFormSubmitted",
        actorType: "system",
        actorName: "live-demo",
        payload: {
          chief_complaint: scenario.chief_complaint,
          phq9_score: scenario.phq9_score,
          gad7_score: scenario.gad7_score,
        },
      });

      const provider = makeLLMProvider();
      const state = await runTriageAgent({ eventLog: log, provider });

      const userId = (req as typeof req & { userId: string }).userId;
      await pool.query(
        "insert into demo_runs (patient_id, user_id, ip) values ($1, $2, $3)",
        [id, userId, req.ip]
      );

      return reply.send(state);
    }
  );
};
