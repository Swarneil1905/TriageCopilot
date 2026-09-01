import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { buildServer } from "../src/app.js";
import { closePool, getPool } from "../src/db.js";

// Real-Postgres integration tests for the Stripe billing routes. No real
// Stripe API key or network access anywhere here: checkout/portal only need
// STRIPE_SECRET_KEY to be *present* to get past their own 503 guard (their
// actual stripe.checkout.sessions.create/stripe.billingPortal.sessions.create
// calls would need a real key and network access, which this offline suite
// deliberately never exercises, matching this project's zero-required-setup
// promise for tests). The webhook route's signature verification is real
// and network-free: it's constructed with the Stripe SDK's own
// webhooks.generateTestHeaderString test helper (pure local HMAC, no API
// call) rather than a hand-rolled signature, per the auth-billing prompt's
// own explicit instruction not to fake that check.
describe("Billing API (real Postgres)", () => {
  let app: FastifyInstance;
  const original = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  };
  const FAKE_KEY = "sk_test_FAKE_KEY_FOR_TESTS_ONLY_00000000000000000000";
  const FAKE_WEBHOOK_SECRET = "whsec_test_fake_secret_for_tests_only";

  beforeAll(async () => {
    app = await buildServer();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  function uniqueEmail() {
    return `billing-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
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

  describe("/billing/checkout and /billing/portal", () => {
    it("both require login: 401 with no session cookie", async () => {
      const checkoutRes = await app.inject({ method: "POST", url: "/api/billing/checkout" });
      expect(checkoutRes.statusCode).toBe(401);
      const portalRes = await app.inject({ method: "POST", url: "/api/billing/portal" });
      expect(portalRes.statusCode).toBe(401);
    });

    it("both return 503 (not a crash) when Stripe isn't configured, matching this test environment", async () => {
      // This suite runs with STRIPE_SECRET_KEY unset, the same as local dev
      // and CI: proves the app boots and responds cleanly with zero Stripe
      // credentials present, per the auth-billing prompt's own guardrail.
      expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
      const cookie = await signUpAndGetCookie(uniqueEmail());

      const checkoutRes = await app.inject({
        method: "POST",
        url: "/api/billing/checkout",
        headers: { cookie },
      });
      expect(checkoutRes.statusCode).toBe(503);

      const portalRes = await app.inject({
        method: "POST",
        url: "/api/billing/portal",
        headers: { cookie },
      });
      expect(portalRes.statusCode).toBe(503);
    });

    it("portal returns 400 for a subscribed-key-present account with no Stripe customer id yet", async () => {
      process.env.STRIPE_SECRET_KEY = FAKE_KEY;
      const cookie = await signUpAndGetCookie(uniqueEmail());

      const res = await app.inject({ method: "POST", url: "/api/billing/portal", headers: { cookie } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/no subscription/i);
    });
  });

  describe("/billing/webhook", () => {
    it("rejects a request with no signature header (400, not a crash)", async () => {
      process.env.STRIPE_SECRET_KEY = FAKE_KEY;
      process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;

      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        payload: JSON.stringify({ id: "evt_test", type: "checkout.session.completed" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/signature verification failed/i);
    });

    it("rejects a tampered payload even with a real signature header for the original payload", async () => {
      process.env.STRIPE_SECRET_KEY = FAKE_KEY;
      process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;

      const originalPayload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload: originalPayload,
        secret: FAKE_WEBHOOK_SECRET,
      });
      const tamperedPayload = JSON.stringify({ id: "evt_test_tampered", type: "checkout.session.completed" });

      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        payload: tamperedPayload,
        headers: { "content-type": "application/json", "stripe-signature": signature },
      });
      expect(res.statusCode).toBe(400);
    });

    it("accepts a genuinely signed checkout.session.completed event and activates the subscription", async () => {
      process.env.STRIPE_SECRET_KEY = FAKE_KEY;
      process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;

      const email = uniqueEmail();
      await signUpAndGetCookie(email);
      const { rows } = await getPool().query("select id from users where email = $1", [email]);
      const userId = (rows[0] as { id: string }).id;

      // Dynamically unique ids, not hardcoded literals: stripe_customer_id
      // and stripe_subscription_id both carry UNIQUE constraints (migration
      // 0003), and a fixed literal collides with a leftover row from an
      // earlier run of this same suite against the real, non-reset sandbox
      // Postgres, the same class of problem uniqueEmail() already avoids
      // for the email column.
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const customerId = `cus_test_${unique}`;
      const subscriptionId = `sub_test_${unique}`;

      const payload = JSON.stringify({
        id: "evt_test_checkout_completed",
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_123",
            object: "checkout.session",
            client_reference_id: userId,
            customer: customerId,
            subscription: subscriptionId,
          },
        },
      });
      // Genuinely signed via the Stripe SDK's own test helper (pure local
      // HMAC over payload + timestamp + secret, no network call), not a
      // hand-rolled signature: this is what actually proves
      // stripe.webhooks.constructEvent's verification path works, not just
      // that the route exists.
      const signature = Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: FAKE_WEBHOOK_SECRET,
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        payload,
        headers: { "content-type": "application/json", "stripe-signature": signature },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });

      const { rows: userRows } = await getPool().query(
        "select stripe_customer_id, stripe_subscription_id, subscription_status from users where id = $1",
        [userId]
      );
      const user = userRows[0] as {
        stripe_customer_id: string;
        stripe_subscription_id: string;
        subscription_status: string;
      };
      expect(user.stripe_customer_id).toBe(customerId);
      expect(user.stripe_subscription_id).toBe(subscriptionId);
      expect(user.subscription_status).toBe("active");
    });

    it("accepts a genuinely signed customer.subscription.deleted event and cancels the subscription", async () => {
      process.env.STRIPE_SECRET_KEY = FAKE_KEY;
      process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;

      const email = uniqueEmail();
      // A dynamically unique subscription id, not a hardcoded literal: this
      // column carries a UNIQUE constraint (migration 0003), and a fixed
      // literal collides with a leftover row from an earlier run of this
      // same suite against the real, non-reset sandbox Postgres, the exact
      // same class of problem uniqueEmail() already avoids for the email
      // column.
      const subId = `sub_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await signUpAndGetCookie(email);
      await getPool().query(
        "update users set stripe_subscription_id = $1, subscription_status = 'active' where email = $2",
        [subId, email]
      );

      const payload = JSON.stringify({
        id: "evt_test_sub_deleted",
        object: "event",
        type: "customer.subscription.deleted",
        data: { object: { id: subId, object: "subscription", status: "canceled" } },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: FAKE_WEBHOOK_SECRET });

      const res = await app.inject({
        method: "POST",
        url: "/api/billing/webhook",
        payload,
        headers: { "content-type": "application/json", "stripe-signature": signature },
      });
      expect(res.statusCode).toBe(200);

      const { rows } = await getPool().query(
        "select subscription_status from users where email = $1",
        [email]
      );
      expect((rows[0] as { subscription_status: string }).subscription_status).toBe("canceled");
    });
  });
});
