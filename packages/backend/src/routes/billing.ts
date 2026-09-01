// Auth-and-billing pass: the $19.99/month subscription free-tier users hit
// once they exhaust FREE_REQUEST_LIMIT (see quota.ts). Hosted Stripe
// Checkout and the hosted Billing Portal, not embedded Elements or a
// Next.js Server Action: this app keeps all real logic on the Fastify
// backend and treats the frontend as a thin client that calls it (see
// lib/api.ts's whole pattern), so the backend creates a session and hands
// back a URL, and the frontend does a plain redirect, the same shape as
// everything else here.
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { getPool } from "../db.js";
import { requireAuth } from "../auth.js";
import { requireTrustedOrigin } from "../security.js";

// Constructed lazily, at request time, not at module load: STRIPE_SECRET_KEY
// is optional for local dev and CI (see .env.example), so importing this
// module must never throw just because it's unset, the same zero-required-
// setup promise as the rest of this app's env vars. Each route below checks
// for the key explicitly first and returns a clear 503 instead of a crash.
function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return new Stripe(key);
}

const BILLING_NOT_CONFIGURED = { error: "Billing is not configured on this deployment yet." };

export const billingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const pool = getPool();

  fastify.post(
    "/billing/checkout",
    // Same ordering as every other cookie-authenticated, state-changing
    // route in this app (see routes/demo.ts and routes/auth.ts):
    // requireTrustedOrigin runs first, so a request from a disallowed
    // origin never even reaches the point of spending a real session.
    { preHandler: [requireTrustedOrigin, requireAuth] },
    async (req, reply) => {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
        return reply.code(503).send(BILLING_NOT_CONFIGURED);
      }
      const stripe = getStripeClient();
      const userId = (req as FastifyRequest & { userId: string }).userId;
      const { rows } = await pool.query(
        "select email, stripe_customer_id from users where id = $1",
        [userId]
      );
      const user = rows[0] as { email: string; stripe_customer_id: string | null };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: user.stripe_customer_id ?? undefined,
        customer_email: user.stripe_customer_id ? undefined : user.email,
        // The reliable way to correlate the webhook back to our own user
        // row: never rely on matching by email or customer id alone, since
        // this id is set by us, not guessable or spoofable from outside.
        client_reference_id: userId,
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${process.env.FRONTEND_PUBLIC_URL}/billing?status=success`,
        cancel_url: `${process.env.FRONTEND_PUBLIC_URL}/billing?status=cancelled`,
      });
      return reply.send({ url: session.url });
    }
  );

  fastify.post(
    "/billing/portal",
    { preHandler: [requireTrustedOrigin, requireAuth] },
    async (req, reply) => {
      if (!process.env.STRIPE_SECRET_KEY) {
        return reply.code(503).send(BILLING_NOT_CONFIGURED);
      }
      const stripe = getStripeClient();
      const userId = (req as FastifyRequest & { userId: string }).userId;
      const { rows } = await pool.query("select stripe_customer_id from users where id = $1", [userId]);
      const customerId = (rows[0] as { stripe_customer_id: string | null } | undefined)?.stripe_customer_id;
      if (!customerId) return reply.code(400).send({ error: "No subscription to manage yet" });

      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.FRONTEND_PUBLIC_URL}/billing`,
      });
      return reply.send({ url: session.url });
    }
  );

  // Nested in its own encapsulated plugin scope so the raw-body content
  // type parser below applies only to this one route, not to
  // /billing/checkout or /billing/portal above, which still need the
  // normal parsed-JSON body Fastify provides everywhere else in this app.
  await fastify.register(async (scope) => {
    // The raw-body gotcha: Stripe's constructEvent needs the exact
    // original bytes of the request body to verify the signature.
    // Fastify's default JSON parser would already have parsed it into an
    // object by the time a normal handler saw it, which breaks
    // verification. Registering a parser here that hands back the raw
    // Buffer instead of a parsed object is what keeps those bytes intact;
    // confirmed this actually works (not just that the route exists) with
    // a real signed test event, constructed via the Stripe SDK's own
    // webhooks.generateTestHeaderString test helper (see
    // test/billing.test.ts), rather than a hand-rolled signature.
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    // No requireAuth, no requireTrustedOrigin: Stripe calls this server to
    // server, never from a browser, so there is no session cookie or
    // Origin header to check in the first place, and requireTrustedOrigin
    // would simply pass a Stripe request through anyway (it only blocks a
    // *present*, disallowed Origin, and Stripe never sends one). This
    // route's entire security rests on the signature check below, not on
    // CORS/Origin logic, so it isn't reached for out of habit either.
    scope.post("/billing/webhook", async (req, reply) => {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        return reply.code(503).send(BILLING_NOT_CONFIGURED);
      }
      const stripe = getStripeClient();

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          req.body as Buffer,
          req.headers["stripe-signature"] as string,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err) {
        return reply
          .code(400)
          .send({ error: `Webhook signature verification failed: ${(err as Error).message}` });
      }

      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.client_reference_id;
          if (userId) {
            await pool.query(
              "update users set stripe_customer_id = $1, stripe_subscription_id = $2, subscription_status = 'active' where id = $3",
              [session.customer, session.subscription, userId]
            );
          }
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          await pool.query("update users set subscription_status = $1 where stripe_subscription_id = $2", [
            event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
            sub.id,
          ]);
          break;
        }
      }
      return reply.send({ received: true });
    });
  });
};
