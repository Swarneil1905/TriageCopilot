import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/app.js";
import { closePool, getPool } from "../src/db.js";
import { resolveGoogleUser, type GoogleProfile } from "../src/routes/oauth.js";

// The account-linking guardrail in routes/oauth.ts (resolveGoogleUser) is
// the one piece of the Google sign-in feature complex enough to deserve
// direct coverage of its own. It's tested here against a real Postgres,
// calling resolveGoogleUser directly with a hand-built profile object,
// deliberately bypassing the actual OAuth2 dance (authorization code
// exchange, Google's real token/userinfo endpoints): none of that machinery
// is needed to exercise the actual business decision (create, link, or
// refuse), and this keeps the suite's zero-real-credentials promise intact
// (see the auth-billing prompt's own guardrail: local dev and CI must keep
// working with no real Google credentials anywhere).
describe("Google account-linking guardrail (real Postgres)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail() {
    return `oauth-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  }

  function uniqueSub() {
    return `google-sub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function getUserRow(email: string) {
    const { rows } = await getPool().query(
      "select id, email, password_hash, google_id from users where email = $1",
      [email]
    );
    return rows[0] as
      | { id: string; email: string; password_hash: string | null; google_id: string | null }
      | undefined;
  }

  it("creates a new Google-only account with no password_hash for a brand-new email", async () => {
    const email = uniqueEmail();
    const sub = uniqueSub();
    const profile: GoogleProfile = { sub, email, email_verified: true };

    const result = await resolveGoogleUser(getPool(), profile);
    expect(result.outcome).toBe("signed_in");

    const row = await getUserRow(email);
    expect(row).toBeDefined();
    expect(row?.google_id).toBe(sub);
    expect(row?.password_hash).toBeNull();
  });

  it("refuses to silently merge a Google sign-in into an existing password account with no linked google_id", async () => {
    const email = uniqueEmail();
    // A real password account, created the ordinary way, with no Google
    // sign-in ever attached to it yet.
    const signupRes = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct-horse-battery" },
    });
    expect(signupRes.statusCode).toBe(201);

    const sub = uniqueSub();
    const profile: GoogleProfile = { sub, email, email_verified: true };
    const result = await resolveGoogleUser(getPool(), profile);

    expect(result.outcome).toBe("refused_account_exists_use_password");

    // Not silently linked: google_id must still be unset on that row.
    const row = await getUserRow(email);
    expect(row?.google_id).toBeNull();
  });

  it("logs in cleanly, without creating a duplicate row, when google_id already matches", async () => {
    const email = uniqueEmail();
    const sub = uniqueSub();
    const profile: GoogleProfile = { sub, email, email_verified: true };

    const first = await resolveGoogleUser(getPool(), profile);
    expect(first.outcome).toBe("signed_in");
    const firstUserId = first.outcome === "signed_in" ? first.userId : undefined;

    const second = await resolveGoogleUser(getPool(), profile);
    expect(second.outcome).toBe("signed_in");
    const secondUserId = second.outcome === "signed_in" ? second.userId : undefined;

    expect(secondUserId).toBe(firstUserId);

    const { rows } = await getPool().query("select id from users where email = $1", [email]);
    expect(rows).toHaveLength(1);
  });

  it("refuses to create or link an account from an unverified Google email", async () => {
    const email = uniqueEmail();
    const sub = uniqueSub();
    const profile: GoogleProfile = { sub, email, email_verified: false };

    const result = await resolveGoogleUser(getPool(), profile);
    expect(result.outcome).toBe("refused_email_not_verified");

    const row = await getUserRow(email);
    expect(row).toBeUndefined();
  });

  it("GET /auth/google returns 503 (not a crash) when Google sign-in isn't configured, matching this test environment", async () => {
    // This suite runs with GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET both
    // unset, the same as local dev and CI: proves the app boots and
    // responds cleanly with zero Google credentials present, matching the
    // same guarantee already proven for Stripe in billing.test.ts.
    expect(process.env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(process.env.GOOGLE_CLIENT_SECRET).toBeUndefined();

    const res = await app.inject({ method: "GET", url: "/api/auth/google" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/not configured/i);
  });
});
