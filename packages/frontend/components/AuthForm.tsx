"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, logIn, signUp } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";

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
          <label htmlFor="email" className="block text-sm font-medium text-stone-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-stone-700">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          {mode === "signup" && <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>}
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
        >
          {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
        </button>
      </form>

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
