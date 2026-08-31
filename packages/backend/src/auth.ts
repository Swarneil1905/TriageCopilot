// Minimal, dependency-free (beyond node:crypto) auth: password hashing and a
// signed session cookie. This exists for exactly one reason -- gating the
// public live-demo trigger (routes/demo.ts) behind a real account, so an
// anonymous visitor can't repeatedly trigger real LLM calls on the site
// owner's API key. It is deliberately not a general-purpose access-control
// system: every other route in this app (patient data, the dashboard, the
// audit log) stays exactly as open as it always was. See 0002_auth_and_demo
// migration's header comment for the full reasoning.

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const SCRYPT_KEYLEN = 64;
const SESSION_COOKIE = "tc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

// Generated once per process if SESSION_SECRET isn't set, so a fresh
// `cp .env.example .env` clone still runs the whole demo (including tests)
// with zero required setup, matching this repo's existing zero-config
// promise for DATABASE_URL. The real, persistent Railway deployment sets a
// stable SESSION_SECRET explicitly (an app-internal signing secret I
// generate and configure myself, not a personal credential) so sessions
// survive a redeploy; without it, every restart silently invalidates every
// existing session, which is a fine, self-healing failure mode for a
// portfolio demo and a bad one for anything real -- hence the loud warning.
let ephemeralSecret: string | null = null;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
    // eslint-disable-next-line no-console
    console.warn(
      "auth: SESSION_SECRET is not set. Generated a random one for this process only. " +
        "Every existing session will be invalidated on restart. Set a real SESSION_SECRET " +
        "(e.g. `openssl rand -hex 32`) for anything beyond local/test use."
    );
  }
  return ephemeralSecret;
}

/** Hashes a password with scrypt + a random salt. Format: "salt:hash", both hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

/** Timing-safe comparison of a plaintext password against a stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

interface SessionPayload {
  uid: string;
  exp: number;
}

function sign(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

/** Builds a signed, expiring session token: base64url(json).hexHmac */
export function createSessionToken(userId: string): string {
  const payload: SessionPayload = { uid: userId, exp: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Verifies a session token's signature and expiry, returning the user id or null. */
export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (typeof payload.uid !== "string" || !payload.uid) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

// The frontend and backend are deployed as two different Railway
// subdomains (frontend-production-*.up.railway.app vs
// backend-production-*.up.railway.app) -- different eTLD+1s from the
// browser's point of view, since *.up.railway.app is a public-suffix-style
// multi-tenant domain. That makes every frontend -> backend fetch call
// genuinely cross-site, so SameSite=Lax (which blocks cookies on
// cross-site fetch/XHR, only allowing top-level navigations) would silently
// never send the session cookie back to the backend at all. SameSite=None
// is required for that to work, which in turn requires Secure -- browsers
// reject SameSite=None without it. Locally, frontend (localhost:3000) and
// backend (localhost:4000) are cross-origin but same-site (same scheme,
// same host, only the port differs), so Lax without Secure is both
// necessary (no HTTPS locally) and sufficient.
function isDeployedProd(): boolean {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production";
}

export function setSessionCookie(reply: FastifyReply, userId: string) {
  const token = createSessionToken(userId);
  const prod = isDeployedProd();
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: prod ? "none" : "lax",
    secure: prod,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  const prod = isDeployedProd();
  reply.clearCookie(SESSION_COOKIE, { path: "/", sameSite: prod ? "none" : "lax", secure: prod });
}

/** Reads and verifies the session cookie on a request, returning the user id or null. */
export function getSessionUserId(req: FastifyRequest): string | null {
  const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  return verifySessionToken(token);
}

/** Fastify preHandler: 401s if there's no valid session, otherwise attaches req.userId. */
export function requireAuth(req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) {
  const userId = getSessionUserId(req);
  if (!userId) {
    reply.code(401).send({ error: "Login required" });
    return;
  }
  (req as FastifyRequest & { userId: string }).userId = userId;
  done();
}
