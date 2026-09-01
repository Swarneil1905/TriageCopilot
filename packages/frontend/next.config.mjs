// Security hardening pass, finding 4: this file was empty, meaning zero
// custom response headers on any page: no Content-Security-Policy, no
// X-Content-Type-Options, no X-Frame-Options, nothing. The headers() below
// fix that. This is the app that actually renders HTML/JS in a browser
// (the backend's JSON API gets the equivalent via @fastify/helmet in
// app.ts instead), so headers matter most here.

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Finding 5 (dependency upgrade): Next 16 makes Turbopack the default
// bundler for both `next dev` and `next build` (Next 15 still defaulted
// `next build` to webpack). Turbopack's own monorepo root inference picked
// the wrong directory here: every route 500'd with "Could not find the
// module ... in the React Client Manifest" against a real `next start`,
// because this repo is an npm workspaces monorepo (packages/frontend is a
// workspace, not the repo root, and dependencies are hoisted to the root
// node_modules). Pointing turbopack.root at the actual monorepo root fixes
// it: confirmed by testing with and without this option against the exact
// same build.
const MONOREPO_ROOT = path.join(__dirname, "../..");

// The backend's own origin, derived from the same NEXT_PUBLIC_API_BASE_URL
// value lib/api.ts already reads (which includes a trailing /api path), so
// CSP's connect-src and that file's own API_BASE_URL can never drift apart
// into two different backend URLs: one derived value, not a second env
// var to keep in sync by hand. Defaults to the local backend dev port,
// matching lib/api.ts's own default.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const BACKEND_ORIGIN = new URL(API_BASE_URL).origin;

// `next dev`'s own Fast Refresh / webpack HMR runtime calls eval() to apply
// hot module updates, verified directly here: the strict CSP below,
// deployed with `next start` (a real production build), produced zero
// console errors across every route in a real Playwright pass, while the
// exact same CSP under `next dev` threw "Refused to evaluate a string as
// JavaScript" on every single page load. That is Next's dev server, not
// this app, and 'unsafe-eval' in production would be a real, unnecessary
// weakening of the one script-src restriction that matters most (it is
// what most XSS-to-code-execution gadgets actually need). So it's added
// only in development, never in the deployed build.
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: MONOREPO_ROOT,
  },
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      {
        key: "Content-Security-Policy",
        // Self-hosted fonts (no external font CDN, see layout.tsx), no
        // inline third-party scripts, images served from this app's own
        // /public/screenshots/. script-src keeps 'unsafe-inline' for
        // Next's own App Router bootstrap script; removing it needs Next's
        // nonce support wired through middleware, which is a deliberate
        // follow-up, not a blocker for shipping a real CSP instead of none.
        value: [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data:",
          "font-src 'self'",
          `connect-src 'self' ${BACKEND_ORIGIN}`,
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      },
    ];

    // Skipped entirely in dev: `next dev` normally serves plain http://
    // locally, and HSTS is a header that (per spec) browsers should ignore
    // outside HTTPS anyway, but there's no upside to sending it locally and
    // it's one less thing to reason about while developing. Verified
    // before adding this in production: both the frontend and backend
    // Railway domains are Railway-managed *.up.railway.app service domains
    // (confirmed via the Railway API, not assumed), and a direct browser
    // navigation to the plain http:// frontend URL resolved only to
    // https://, with every subsequent request over TLS. No plain-HTTP
    // path was ever observed. HSTS is safe to ship on that basis; it would
    // not be safe to guess at.
    if (!isDev) {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains",
      });
    }

    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
