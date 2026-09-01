// Auth-and-billing pass: Google sign-in via @fastify/oauth2, the standard
// Fastify plugin for exactly this, with a built-in Google preset. The
// callback just calls the already-built setSessionCookie(reply, user.id),
// the same call password login already makes, so the rest of the app
// (NavBar, SessionProvider, every quota/admin check in quota.ts/admin.ts)
// treats a Google-authenticated session identically to a password one;
// nothing downstream needs to know or care which one a user signed in
// with.
//
// GOOGLE_CLIENT_ID/SECRET are optional for local dev and CI (see
// .env.example): when either is missing, this plugin registers a plain
// fallback at /auth/google returning a clear 503 instead of silently
// building an OAuth redirect URL with an empty client id, matching the
// same configured-or-clear-503 pattern as routes/billing.ts's Stripe
// routes.
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import oauthPlugin, { type OAuth2Namespace, type ProviderConfiguration } from "@fastify/oauth2";
import type { Pool } from "pg";
import { getPool } from "../db.js";
import { setSessionCookie } from "../auth.js";

const GOOGLE_NOT_CONFIGURED = { error: "Google sign-in is not configured on this deployment yet." };

export interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
}

export type GoogleSignInResult =
  | { outcome: "signed_in"; userId: string }
  | { outcome: "refused_email_not_verified" }
  | { outcome: "refused_account_exists_use_password" };

// Pulled out of the callback route so it can be exercised directly against
// a real Postgres in tests, with no real Google network call anywhere: the
// account-linking guardrail is the one piece of this feature complex enough
// to deserve direct coverage of its own (new email, existing password
// account with no google_id yet, existing google_id match), and none of
// that logic actually needs the OAuth2 dance itself, only a profile shape.
export async function resolveGoogleUser(pool: Pool, profile: GoogleProfile): Promise<GoogleSignInResult> {
  // Don't ever create/link an account off an unverified Google email:
  // Google itself flags this when the address hasn't completed its own
  // verification flow, and trusting it anyway would let someone sign in as
  // an email they don't actually control.
  if (!profile.email_verified) {
    return { outcome: "refused_email_not_verified" };
  }
  const email = profile.email.toLowerCase();

  const { rows } = await pool.query(
    "select id, password_hash, google_id from users where google_id = $1 or email = $2",
    [profile.sub, email]
  );
  const existing = rows[0] as
    | { id: string; password_hash: string | null; google_id: string | null }
    | undefined;

  if (existing) {
    const alreadyLinkedToThisGoogleAccount = existing.google_id === profile.sub;
    // Account-linking guardrail: this app's password signup never verifies
    // email ownership (no confirmation email), so silently logging a Google
    // sign-in into a pre-existing password account would let whoever
    // originally typed in that email keep using the password to reach an
    // account the real owner now thinks is "theirs" via Google. Safe case:
    // no password set yet (a previous Google sign-in, or a bare row with
    // neither credential yet), or google_id already matches this exact
    // Google account. Unsafe case: a password is set and this Google
    // account isn't already the one linked to it: refuse to silently merge.
    if (existing.password_hash && !alreadyLinkedToThisGoogleAccount) {
      return { outcome: "refused_account_exists_use_password" };
    }
    if (!alreadyLinkedToThisGoogleAccount) {
      await pool.query("update users set google_id = $1 where id = $2", [profile.sub, existing.id]);
    }
    return { outcome: "signed_in", userId: existing.id };
  }

  const { rows: created } = await pool.query(
    "insert into users (email, google_id) values ($1, $2) returning id",
    [email, profile.sub]
  );
  return { outcome: "signed_in", userId: (created[0] as { id: string }).id };
}

export const oauthRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    fastify.get("/auth/google", async (_req, reply) => reply.code(503).send(GOOGLE_NOT_CONFIGURED));
    return;
  }

  const backendUrl = process.env.BACKEND_PUBLIC_URL ?? "http://localhost:4000";
  const frontendUrl = process.env.FRONTEND_PUBLIC_URL ?? "http://localhost:3000";

  await fastify.register(oauthPlugin, {
    name: "googleOAuth2",
    scope: ["profile", "email"],
    credentials: {
      client: { id: clientId, secret: clientSecret },
      // The installed package's own .d.ts doesn't carry this static
      // property through its declared function type (a real gap in that
      // package's types, not this app's own convention), so a narrow cast
      // reads it here rather than duplicating Google's OAuth endpoint URLs
      // by hand.
      auth: (oauthPlugin as unknown as { GOOGLE_CONFIGURATION: ProviderConfiguration })
        .GOOGLE_CONFIGURATION,
    },
    // Registered on this same plugin instance, which app.ts mounts with
    // {prefix: "/api"}, so the real exposed path is /api/auth/google, and
    // this callbackUri (which must match a redirect URI configured in the
    // Google Cloud Console exactly, including the /api prefix) below.
    startRedirectPath: "/auth/google",
    callbackUri: `${backendUrl}/api/auth/google/callback`,
    callbackUriParams: { access_type: "offline" },
    pkce: "S256",
  });

  const pool = getPool();
  const googleOAuth2 = (fastify as FastifyInstance & { googleOAuth2: OAuth2Namespace }).googleOAuth2;

  fastify.get("/auth/google/callback", async (req, reply) => {
    const { token } = await googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
    const profile = (await googleOAuth2.userinfo(token.access_token)) as GoogleProfile;

    const result = await resolveGoogleUser(pool, profile);
    if (result.outcome === "refused_email_not_verified") {
      return reply.redirect(`${frontendUrl}/login?error=email_not_verified`);
    }
    if (result.outcome === "refused_account_exists_use_password") {
      return reply.redirect(`${frontendUrl}/login?error=account_exists_use_password`);
    }

    setSessionCookie(reply, result.userId);
    reply.redirect(frontendUrl);
  });
};
