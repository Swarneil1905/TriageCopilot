import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool } from "../src/db.js";
import { FREE_REQUEST_LIMIT } from "../src/quota.js";

// Real-Postgres integration tests, same reasoning as api.test.ts: this is
// the one place worth exercising the actual HTTP + cookie round trip rather
// than unit-testing auth.ts in isolation, since the whole point is proving
// the signed session cookie genuinely survives a request/response cycle.
describe("Auth API (real Postgres)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail() {
    return `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  it("signs up, sets a session cookie, and /auth/me reflects it", async () => {
    const email = uniqueEmail();
    const signupRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(signupRes.statusCode).toBe(201);
    expect(signupRes.json()).toEqual({ email });
    const cookie = extractSessionCookie(signupRes);

    const meRes = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(meRes.statusCode).toBe(200);
    // Auth-and-billing pass: /auth/me now also reports admin/subscription
    // state and free-tier usage (see quota.ts and routes/auth.ts). A brand
    // new signup is a plain, non-admin, non-subscribed free-tier account
    // that hasn't used any of its allowance yet.
    expect(meRes.json()).toEqual({
      email,
      isAdmin: false,
      isSubscribed: false,
      requestsUsed: 0,
      requestsRemaining: FREE_REQUEST_LIMIT,
    });
  });

  it("rejects a duplicate signup email with 409", async () => {
    const email = uniqueEmail();
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "a-different-password" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("rejects signup with too short a password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: uniqueEmail(), password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const email = uniqueEmail();
    await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "wrong-password-entirely" },
    });
    expect(wrongPassword.statusCode).toBe(401);

    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: uniqueEmail(), password: "correct-horse-battery" },
    });
    expect(unknownEmail.statusCode).toBe(401);

    const rightPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(rightPassword.statusCode).toBe(200);
    expect(rightPassword.json()).toEqual({ email });
  });

  it("logout tells the browser to drop the cookie", async () => {
    const email = uniqueEmail();
    const signupRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    const cookie = extractSessionCookie(signupRes);

    const before = await app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(before.statusCode).toBe(200);

    const logoutRes = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logoutRes.statusCode).toBe(200);
    // clearCookie sends Set-Cookie with an empty value plus an expiry in the
    // past: that's the actual mechanism, and it's a client-side
    // instruction, not server-side revocation. This session scheme is a
    // stateless signed token with no server-side session store (see
    // auth.ts), so a client that ignores the clear and resends the exact
    // same cookie string is still authenticated until it naturally expires
    // (1 day, shortened from an earlier 30, see the security hardening
    // pass's finding 6 comment on SESSION_TTL_MS in auth.ts), a deliberate
    // simplicity/statelessness tradeoff worth being explicit about rather
    // than a bug, and the reason there's no "log out everywhere" or
    // token-revocation feature here.
    const setCookieHeader = logoutRes.headers["set-cookie"];
    expect(String(setCookieHeader)).toMatch(/tc_session=;/);

    // No cookie at all reads as logged-out, which is the case that actually
    // matters for a browser that respects the clear instruction.
    const after = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(after.json()).toEqual({ email: null });
  });

  it("/auth/me is 200 with email:null for no cookie or a garbage cookie", async () => {
    // Deliberately 200, not 401: "not logged in" is the ordinary case for
    // most requests to this endpoint (it's checked on every page load), not
    // an error. See the comment on this route for why.
    const noCookie = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(noCookie.statusCode).toBe(200);
    expect(noCookie.json()).toEqual({ email: null });

    const garbage = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: "tc_session=not-a-real-token" },
    });
    expect(garbage.statusCode).toBe(200);
    expect(garbage.json()).toEqual({ email: null });
  });
});
