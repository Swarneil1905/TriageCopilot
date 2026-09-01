// Admin status lives in an env var, not a database column, on purpose,
// following the same pattern this repo already uses for its other pieces of
// trusted config (CORS_ALLOWED_ORIGINS, SESSION_SECRET): no new migration,
// no role column that a bug in signup logic could accidentally set, no way
// to grant admin except by editing the Railway backend service's own
// environment. The site owner (swarneil1905@gmail.com) gets unlimited AI
// agent use by logging in normally, Google or password, with that exact
// email; there is no special account row, no separate code path, just this
// check at the same point every other user's quota gets checked (see
// quota.ts's checkQuota).
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/** Checks a session's own, DB-looked-up email against the allowlist above.
 * Never call this with a client-supplied header or body field; the caller
 * must have already resolved the email from a verified session (see
 * getSessionUserId plus a users table lookup, as quota.ts does). */
export function isAdminEmail(email: string): boolean {
  return adminEmails.includes(email.toLowerCase());
}
