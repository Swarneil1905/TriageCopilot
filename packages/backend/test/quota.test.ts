import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool, getPool } from "../src/db.js";
import { FREE_REQUEST_LIMIT } from "../src/quota.js";

// Real-Postgres integration tests for the auth-and-billing pass's business
// gate on the AI triage agent: admin gets unlimited use, a free-tier
// account gets FREE_REQUEST_LIMIT lifetime runs then a 402, an active
// subscription gets unlimited use, and a failed run never costs part of the
// caller's free allowance. Exercised against both places a real agent run
// can be triggered (run-triage and demo/run), since quota.ts's checkQuota
// and recordAgentRun are shared by both and must behave identically.
describe("AI agent quota gate (real Postgres)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail(label: string) {
    return `quota-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  }

  function extractSessionCookie(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers["set-cookie"];
    const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
    for (const c of list) {
      const match = /tc_session=([^;]+)/.exec(c);
      if (match) return `tc_session=${match[1]}`;
    }
    throw new Error("no tc_session cookie in response");
  }

  async function signUpAndGetCookie(email: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(201);
    return extractSessionCookie(res);
  }

  /** For the one fixed admin address (not a fresh uniqueEmail() per test):
   * signs up on a first run against a clean database, or logs in if a
   * previous run of this suite against the same real Postgres already
   * created that account, so this test stays idempotent across repeated
   * runs rather than only passing once. */
  async function signUpOrLogInAndGetCookie(email: string): Promise<string> {
    const signupRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    if (signupRes.statusCode === 201) return extractSessionCookie(signupRes);

    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(loginRes.statusCode).toBe(200);
    return extractSessionCookie(loginRes);
  }

  async function usedCount(email: string): Promise<number> {
    const { rows } = await getPool().query("select ai_requests_used from users where email = $1", [email]);
    return (rows[0] as { ai_requests_used: number } | undefined)?.ai_requests_used ?? 0;
  }

  /** A fresh patient, past intake, ready for its one and only run-triage
   * call: the state machine only allows starting triage from
   * "intake_submitted" or "clinician_rejected" (see stateMachine.ts's
   * assertValidAppend), so each call below needs its own patient. */
  async function createIntakenPatient(): Promise<string> {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/patients",
      payload: { display_name: "Quota Test Patient" },
    });
    const patientId = createRes.json().patientId as string;
    await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/intake`,
      payload: { chief_complaint: "quota test intake" },
    });
    return patientId;
  }

  it("admin (ADMIN_EMAILS) never gets blocked and never has usage counted", async () => {
    // Requires ADMIN_EMAILS to include this exact address in the test
    // environment (see .env / .env.example); skips gracefully otherwise
    // rather than failing on an environment-specific assumption.
    const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
    if (!adminEmails.includes("swarneil1905@gmail.com")) {
      return;
    }
    const cookie = await signUpOrLogInAndGetCookie("swarneil1905@gmail.com");

    for (let i = 0; i < FREE_REQUEST_LIMIT + 2; i++) {
      const patientId = await createIntakenPatient();
      const res = await app.inject({
        method: "POST",
        url: `/api/patients/${patientId}/run-triage`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await usedCount("swarneil1905@gmail.com")).toBe(0);
  });

  it("free-tier run-triage: exactly FREE_REQUEST_LIMIT succeed, the next returns 402 with quota detail", async () => {
    const email = uniqueEmail("run-triage");
    const cookie = await signUpAndGetCookie(email);

    for (let i = 0; i < FREE_REQUEST_LIMIT; i++) {
      const patientId = await createIntakenPatient();
      const res = await app.inject({
        method: "POST",
        url: `/api/patients/${patientId}/run-triage`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(await usedCount(email)).toBe(FREE_REQUEST_LIMIT);

    const overLimitPatientId = await createIntakenPatient();
    const blocked = await app.inject({
      method: "POST",
      url: `/api/patients/${overLimitPatientId}/run-triage`,
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(402);
    const body = blocked.json();
    expect(body.quota).toEqual({
      allowed: false,
      reason: "free_tier_exhausted",
      requestsUsed: FREE_REQUEST_LIMIT,
      requestsRemaining: 0,
    });
    // Still exactly FREE_REQUEST_LIMIT: the blocked attempt never reached
    // recordAgentRun, so it doesn't cost anything further.
    expect(await usedCount(email)).toBe(FREE_REQUEST_LIMIT);
  });

  it("free-tier demo/run: the (FREE_REQUEST_LIMIT + 1)th call is a 402, not a 429, even though the per-account rate limit's own max is also FREE_REQUEST_LIMIT", async () => {
    const email = uniqueEmail("demo-run");
    const cookie = await signUpAndGetCookie(email);

    for (let i = 0; i < FREE_REQUEST_LIMIT; i++) {
      const res = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
      expect(res.statusCode).toBe(200);
    }

    const blocked = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
    // The quota preHandler runs before the rate limiter's own injected
    // check (see routes/demo.ts's comment on preHandler ordering), so a
    // free-tier account that has simultaneously exhausted both gets the
    // more specific, actionable 402, not a generic 429.
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().quota.reason).toBe("free_tier_exhausted");
  });

  it("a failed run-triage attempt does not consume any of the free-tier allowance", async () => {
    const email = uniqueEmail("failed-run");
    const cookie = await signUpAndGetCookie(email);
    const patientId = await createIntakenPatient();

    const first = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/run-triage`,
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(await usedCount(email)).toBe(1);

    // Same patient, already past "intake_submitted": the state machine
    // rejects a second TriageAgentStarted (see stateMachine.ts's
    // assertValidAppend) with a 409, thrown before runTriageAgent ever
    // resolves, so recordAgentRun is never reached for this call.
    const second = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/run-triage`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(409);
    expect(await usedCount(email)).toBe(1);
  });

  it("an active subscription allows more than FREE_REQUEST_LIMIT run-triage calls, never returning 402", async () => {
    const email = uniqueEmail("subscribed");
    const cookie = await signUpAndGetCookie(email);
    await getPool().query("update users set subscription_status = 'active' where email = $1", [email]);

    for (let i = 0; i < FREE_REQUEST_LIMIT + 2; i++) {
      const patientId = await createIntakenPatient();
      const res = await app.inject({
        method: "POST",
        url: `/api/patients/${patientId}/run-triage`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
    }
    // Unlike admin, a subscribed (non-admin) account's usage still
    // increments; it just never gates anything once subscribed (see
    // quota.ts's recordAgentRun, which only skips counting for admins).
    expect(await usedCount(email)).toBe(FREE_REQUEST_LIMIT + 2);
  });
});
