import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool } from "../src/db.js";

// Real-Postgres integration tests for the security hardening pass: the CORS
// allowlist (finding 1), the Origin/CSRF preHandler (finding 3), the new
// login/signup rate limits (finding 2), and the signup race fix
// (finding 7). Same buildServer()-plus-inject() approach as auth.test.ts
// and demo.test.ts, for the same reason: this is the one place worth
// exercising the real HTTP layer these fixes actually live in, not
// unit-testing security.ts in isolation.
describe("Security hardening (real Postgres)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail() {
    return `sec-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  }

  describe("CORS allowlist (finding 1)", () => {
    it("reflects Access-Control-Allow-Origin for an allowed origin", async () => {
      // CORS_ALLOWED_ORIGINS is unset in this test run, so security.ts
      // falls back to its documented local-dev default.
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://localhost:3000" },
      });
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });

    it("does not reflect Access-Control-Allow-Origin for a disallowed origin", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "https://evil.example" },
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("requireTrustedOrigin (finding 3)", () => {
    it("rejects /auth/login with a disallowed Origin header, before it ever touches credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "https://evil.example" },
        payload: { email: uniqueEmail(), password: "does-not-matter-at-all" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects /auth/signup with a disallowed Origin header", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        headers: { origin: "https://evil.example" },
        payload: { email: uniqueEmail(), password: "correct-horse-battery" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("rejects /demo/run with a disallowed Origin header even with a valid session cookie", async () => {
      const signupRes = await app.inject({
        method: "POST",
        url: "/api/auth/signup",
        payload: { email: uniqueEmail(), password: "correct-horse-battery" },
      });
      const raw = signupRes.headers["set-cookie"];
      const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
      const cookie = list.map((c) => /tc_session=([^;]+)/.exec(c)?.[0]).find(Boolean);
      expect(cookie).toBeTruthy();

      const res = await app.inject({
        method: "POST",
        url: "/api/demo/run",
        headers: { origin: "https://evil.example", cookie: cookie! },
      });
      // requireTrustedOrigin runs before requireAuth (see routes/demo.ts),
      // so this is a 403, not a 401: the whole point is that an untrusted
      // origin never even gets to spend the visitor's real session.
      expect(res.statusCode).toBe(403);
    });

    it("still allows requests with no Origin header at all (same-origin nav, curl, this test suite)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: uniqueEmail(), password: "wrong-on-purpose" },
      });
      // No Origin header is let through the trusted-origin check; this
      // still 401s on its own merits (unknown email), proving the request
      // reached the real handler rather than being blocked at the door.
      expect(res.statusCode).toBe(401);
    });
  });

  describe("login/signup rate limiting (finding 2)", () => {
    // Each of these two tests uses its own fake source IP (light-my-request's
    // remoteAddress inject option), isolating it from every other test in
    // this file and from auth.test.ts's own organic login/signup calls,
    // since @fastify/rate-limit's default keyGenerator keys on req.ip and
    // all of those other calls share Fastify's default injected IP.

    it("blocks repeated /auth/signup attempts from the same IP past the limit", async () => {
      const ip = "203.0.113.10"; // TEST-NET-3, RFC 5737, never a real client
      let lastStatus = 0;
      for (let i = 0; i < 9; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/signup",
          remoteAddress: ip,
          payload: { email: uniqueEmail(), password: "correct-horse-battery" },
        });
        lastStatus = res.statusCode;
        if (lastStatus === 429) break;
      }
      // Max is 8 per 15 minutes (see routes/auth.ts's config.rateLimit on
      // /auth/signup); the 9th request from the same IP must be blocked.
      expect(lastStatus).toBe(429);
    });

    it("blocks repeated /auth/login attempts from the same IP past the limit", async () => {
      const ip = "203.0.113.20";
      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          remoteAddress: ip,
          payload: { email: uniqueEmail(), password: "guessed-wrong-on-purpose" },
        });
        lastStatus = res.statusCode;
        if (lastStatus === 429) break;
      }
      // Max is 10 per 15 minutes (see routes/auth.ts's config.rateLimit on
      // /auth/login); the 11th request from the same IP must be blocked,
      // proving a brute-force script can't just guess indefinitely.
      expect(lastStatus).toBe(429);
    });
  });

  describe("signup race condition (finding 7)", () => {
    it("returns 409, not a raw 500, when two concurrent signups race for the same email", async () => {
      const email = uniqueEmail();
      const ip = "203.0.113.30"; // its own IP: two requests here shouldn't cost this test rate-limit budget shared with the tests above
      const [first, second] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/auth/signup",
          remoteAddress: ip,
          payload: { email, password: "correct-horse-battery" },
        }),
        app.inject({
          method: "POST",
          url: "/api/auth/signup",
          remoteAddress: ip,
          payload: { email, password: "a-different-password" },
        }),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort();
      // Exactly one of the two concurrent inserts wins (201); the other
      // hits the unique constraint and, with the finding 7 fix, is caught
      // and turned into the same 409 signup already returns for a
      // sequential duplicate, not an unhandled 500.
      expect(statuses).toEqual([201, 409]);
    });
  });
});
