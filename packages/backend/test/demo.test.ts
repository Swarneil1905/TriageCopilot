import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool, getPool } from "../src/db.js";

// Real-Postgres integration tests for the public live-demo trigger: auth
// gating, that it actually runs a real triage-agent turn (against the fake
// provider here, so this stays offline/zero-cost like the rest of the
// suite), that demo patients are excluded from the main dashboard listing,
// and that the daily cap and per-user rate limit both actually bind.
describe("Live demo API (real Postgres)", () => {
  let app: FastifyInstance;
  const originalDailyCap = process.env.DEMO_DAILY_CAP;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterEach(() => {
    if (originalDailyCap === undefined) delete process.env.DEMO_DAILY_CAP;
    else process.env.DEMO_DAILY_CAP = originalDailyCap;
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail() {
    return `demo-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  async function signUpAndGetCookie(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: uniqueEmail(), password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(201);
    return extractSessionCookie(res);
  }

  /** Auth-and-billing pass: signs up, then marks the new account as an
   * active Stripe subscriber directly in the database, so quota.ts's
   * checkQuota returns "subscribed" (unlimited) for it. Used only by tests
   * below this comment that need more than FREE_REQUEST_LIMIT (5) demo
   * runs from one account, so they exercise the per-account rate limit in
   * isolation from the separate, lower free-tier lifetime cap. */
  async function signUpSubscribedAndGetCookie(): Promise<string> {
    const email = uniqueEmail();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(201);
    await getPool().query("update users set subscription_status = 'active' where email = $1", [email]);
    return extractSessionCookie(res);
  }

  it("requires login: 401 with no session cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/demo/run" });
    expect(res.statusCode).toBe(401);
  });

  it("runs a real (fake-provider) triage agent turn and returns a reviewable state", async () => {
    const cookie = await signUpAndGetCookie();
    const res = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const state = res.json();
    expect(state.patientId).toBeTruthy();
    // The default fake script always ends in a reviewable status (see
    // llmProvider.ts), proving the orchestrator's forced-handoff guarantee
    // held for a demo-triggered run exactly like any other.
    expect(["pending_clinician_review", "urgent_review"]).toContain(state.status);
    expect(Array.isArray(state.events)).toBe(true);
    expect(state.events.some((e: { type: string }) => e.type === "TriageToolCalled")).toBe(true);
  });

  it("excludes demo patients from the main dashboard listing but they're still directly reachable", async () => {
    const cookie = await signUpAndGetCookie();
    const runRes = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
    const { patientId } = runRes.json();

    const listRes = await app.inject({ method: "GET", url: "/api/patients" });
    const listedIds = (listRes.json() as Array<{ patientId: string }>).map((p) => p.patientId);
    expect(listedIds).not.toContain(patientId);

    const directRes = await app.inject({ method: "GET", url: `/api/patients/${patientId}` });
    expect(directRes.statusCode).toBe(200);
    expect(directRes.json().patientId).toBe(patientId);
  });

  it("enforces the daily cap once it's reached", async () => {
    const cookie = await signUpAndGetCookie();
    const pool = getPool();
    const { rows } = await pool.query(
      `select count(*)::int as count from demo_runs where created_at >= date_trunc('day', now() at time zone 'utc')`
    );
    const currentCount = rows[0].count as number;
    // Set the cap to exactly one more than what's already used today, so
    // this test is self-consistent regardless of how many demo runs a
    // shared dev Postgres has already accumulated today from other test
    // runs; it doesn't assume a fresh/empty demo_runs table.
    process.env.DEMO_DAILY_CAP = String(currentCount + 1);

    const withinCap = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
    expect(withinCap.statusCode).toBe(200);

    const overCap = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
    expect(overCap.statusCode).toBe(429);
    expect(overCap.json().error).toMatch(/daily limit/i);
  });

  it("rate-limits repeated runs from the same account within the time window", async () => {
    // A fresh account each test avoids colliding with another test's quota,
    // since the limiter keys on userId (see routes/demo.ts). Subscribed
    // (not plain free-tier) so this test exercises the per-account rate
    // limit (max 5) in isolation from the separate free-tier lifetime cap
    // (also 5, see quota.ts): without this, the 6th call here would 402
    // from the quota check instead of 429 from the rate limiter, since
    // both would be exhausted by exactly the same six calls.
    const cookie = await signUpSubscribedAndGetCookie();
    process.env.DEMO_DAILY_CAP = "1000"; // isolate this test from the daily-cap behavior above

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: "POST", url: "/api/demo/run", headers: { cookie } });
      lastStatus = res.statusCode;
      if (lastStatus === 429) break;
    }
    // The 6th request within 15 minutes must be blocked: max is 5 (see
    // routes/demo.ts config.rateLimit).
    expect(lastStatus).toBe(429);
  });
});
