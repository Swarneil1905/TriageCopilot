"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { API_BASE_URL, ApiError, logIn, signUp } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";
import { Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { FieldError } from "@/components/ui/FieldError";

// Google's own OAuth callback (routes/oauth.ts) redirects back here with one
// of these two codes when it refuses to sign someone in, rather than a raw
// backend error string, so this map is the one place that turns each code
// into something a visitor actually understands.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  email_not_verified: "That Google account's email isn't verified yet. Verify it with Google, then try again.",
  account_exists_use_password:
    "An account with this email already has a password set. Log in with your password instead of Google.",
};

interface AuthFormProps {
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();
  const next = searchParams.get("next") || "/";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("error");
    if (code) setError(OAUTH_ERROR_MESSAGES[code] ?? "Could not sign in with Google.");
  }, [searchParams]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      if (mode === "signup") {
        await signUp(email, password);
      } else {
        await logIn(email, password);
      }
      // Updates the one shared session context (NavBar, the landing page's
      // live-demo section) immediately, rather than leaving them showing
      // stale logged-out state until a full page reload. router.refresh()
      // alone only invalidates server-rendered data, not this client state.
      await refresh();
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong, please try again.");
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="font-display text-2xl font-semibold text-stone-900">
        {mode === "signup" ? "Create an account" : "Log in"}
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        {mode === "signup"
          ? "Only needed to run the live AI demo on the landing page. Everything else here (the dashboard, every patient, the audit log) has never required an account."
          : "Welcome back."}
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            invalid={Boolean(error)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            invalid={Boolean(error)}
            className="mt-1"
          />
          {mode === "signup" && <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>}
        </div>

        <FieldError message={error} />

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-3 text-xs text-stone-400">
        <div className="h-px flex-1 bg-stone-200" />
        <span>or</span>
        <div className="h-px flex-1 bg-stone-200" />
      </div>

      {/* A plain anchor tag, not a button with an onClick handler: this has
          to be a real browser navigation to the backend's own /auth/google
          redirect endpoint (see routes/oauth.ts), which itself redirects on
          to Google. A fetch call here couldn't follow that chain the way a
          full page navigation does. No "next" param: the backend callback
          always lands back on the site root today (see routes/oauth.ts),
          so passing one here would just be silently ignored rather than
          honored, and this app never claims a behavior it doesn't have. */}
      <a
        href={`${API_BASE_URL}/auth/google`}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
      >
        <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
          />
          <path
            fill="#34A853"
            d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
          />
          <path
            fill="#FBBC05"
            d="M11.69 28.18A13.94 13.94 0 0 1 10.9 24c0-1.45.25-2.86.7-4.18v-5.7H4.34A21.93 21.93 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88z"
          />
          <path
            fill="#EA4335"
            d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
          />
        </svg>
        Continue with Google
      </a>

      <p className="mt-6 text-sm text-stone-600">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-teal-700 hover:underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-teal-700 hover:underline">
              Sign up
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
