import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool } from "../src/db.js";

// This is the one test file in the suite that needs a real Postgres --
// per SPEC.md §12/§13, `docker compose up -d db` runs before `npm test`.
// Every other test file (stateMachine/tools/llmProvider/triageAgent) stays
// pure and DB-free by design; this one exists specifically to prove the
// HTTP layer + PgEventLog + real transactions all wire together correctly.
describe("API integration (real Postgres)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("walks a full patient journey through the HTTP API, invariants and all", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/patients",
      payload: { display_name: "API Test Patient" },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.status).toBe("intake_pending");
    const patientId = created.patientId as string;

    const intakeRes = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/intake`,
      payload: { chief_complaint: "low mood, trouble sleeping" },
    });
    expect(intakeRes.statusCode).toBe(200);
    expect(intakeRes.json().status).toBe("intake_submitted");

    // Uses the default fake LLM provider (LLM_PROVIDER unset in the test
    // environment) -- a well-behaved low-risk script, per makeLLMProvider.
    const triageRes = await app.inject({ method: "POST", url: `/api/patients/${patientId}/run-triage` });
    expect(triageRes.statusCode).toBe(200);
    const afterTriage = triageRes.json();
    expect(afterTriage.status).toBe("pending_clinician_review");
    expect(afterTriage.riskLevel).toBe("low");

    // Invariant enforcement surfaces as a real 409 over HTTP, not just as an
    // internal exception -- scheduling a follow-up before clinician sign-off
    // must be rejected.
    const prematureFollowUp = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/schedule-follow-up`,
      payload: { date: "2026-03-01", method: "video" },
    });
    expect(prematureFollowUp.statusCode).toBe(409);

    const decisionRes = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/clinician-decision`,
      payload: { decision: "approved", note: "agreed with the draft", clinician_name: "Dr. Rivera" },
    });
    expect(decisionRes.statusCode).toBe(200);
    expect(decisionRes.json().status).toBe("clinician_approved");

    const followUpRes = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/schedule-follow-up`,
      payload: { date: "2026-03-01", method: "video" },
    });
    expect(followUpRes.statusCode).toBe(200);
    expect(followUpRes.json().status).toBe("follow_up_scheduled");

    const auditRes = await app.inject({ method: "GET", url: `/api/patients/${patientId}/audit-log` });
    expect(auditRes.statusCode).toBe(200);
    const audit = auditRes.json();
    expect(audit.patientId).toBe(patientId);
    expect(audit.events.length).toBeGreaterThanOrEqual(8);

    const listRes = await app.inject({ method: "GET", url: "/api/patients" });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.some((p: any) => p.patientId === patientId)).toBe(true);
  });

  it("returns 404 for a well-formed but unknown patient id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/patients/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for a malformed patient id (not a UUID)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/patients/not-a-real-id" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a malformed intake payload", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/patients",
      payload: { display_name: "Validation Test Patient" },
    });
    const patientId = createRes.json().patientId as string;

    const res = await app.inject({
      method: "POST",
      url: `/api/patients/${patientId}/intake`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("health check responds ok and reports the active LLM provider", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    // llmProvider mirrors whatever LLM_PROVIDER is set to at runtime -- the
    // frontend reads this to render the "Powered by <provider>" badge on
    // the Agent Reasoning panel, so it needs to be a real, live value
    // rather than hardcoded, and tests must not assume a specific one.
    expect(res.json()).toEqual({ ok: true, llmProvider: expect.any(String) });
  });
});
