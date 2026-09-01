// The one shared trust boundary for cross-origin requests, used by both the
// CORS registration in app.ts and the requireTrustedOrigin preHandler below.
// Kept in one module, rather than duplicated inline in each place, so the
// CORS allowlist and the Origin check can never silently drift apart from
// each other: security hardening pass, finding 1 (CORS was origin: true,
// reflecting every request's Origin back with credentials: true, which
// defeats the whole point of the login gate in front of the public live
// demo, see routes/demo.ts) and finding 3 (fixing CORS alone stops a
// malicious page's JavaScript from reading the response, but not the
// browser from sending the cookie-bearing request in the first place).
//
// Defaults to the local frontend dev origin so `npm run backend:dev` /
// `npm run frontend:dev` keep working with zero new required env vars; the
// deployed Railway backend sets CORS_ALLOWED_ORIGINS explicitly to the real
// deployed frontend origin (comma-separated if a custom domain is ever
// added alongside it).
import type { FastifyReply, FastifyRequest } from "fastify";

export const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * Fastify preHandler: rejects a request whose Origin header is present but
 * not on the allowlist above. A same-origin browser navigation, or a
 * non-browser client (curl, a server-to-server call, this repo's own test
 * suite via fastify.inject()) sends no Origin header at all and is let
 * through unconditionally; only a *present*, disallowed Origin is rejected.
 * This mirrors the trust decision the CORS allowlist already makes, so the
 * two can't disagree with each other. Applied to every state-changing,
 * cookie-authenticated route (login, signup, logout, the live demo run).
 */
export function requireTrustedOrigin(
  req: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void
) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) {
    reply.code(403).send({ error: "Cross-origin request rejected" });
    return;
  }
  done();
}
