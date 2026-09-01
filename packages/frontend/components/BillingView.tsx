"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ApiError, openBillingPortal, startCheckout } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";

// Mirrors quota.ts's FREE_REQUEST_LIMIT on the backend. Duplicated rather
// than imported, same as every other domain constant/type in lib/api.ts:
// this frontend stays dependency-free of the backend package by design.
const FREE_REQUEST_LIMIT = 5;
// How long to keep polling /auth/me after a successful-looking Checkout
// redirect before giving up and telling the visitor to check back: the
// webhook that actually flips subscription_status usually lands within a
// couple of seconds, but never trust the redirect itself as proof of
// payment (see routes/billing.ts's own comment on this exact point).
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 20;

function NotConfiguredNotice() {
  return (
    <p className="mt-3 text-sm text-stone-500">
      Billing isn&apos;t configured on this deployment yet. This is expected in local development and
      most preview environments; it just means STRIPE_SECRET_KEY hasn&apos;t been set.
    </p>
  );
}

export function BillingView() {
  const { user, loading: sessionLoading, refresh } = useSession();
  const searchParams = useSearchParams();
  const status = searchParams.get("status");

  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalPending, setPortalPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [polling, setPolling] = useState(status === "success");
  const pollCount = useRef(0);

  // Polls /auth/me rather than trusting ?status=success on its own: that
  // query param only proves Stripe's own redirect happened, not that the
  // webhook already updated this account (the two can arrive out of order,
  // and the webhook is the only side of this that's actually authoritative).
  useEffect(() => {
    if (!polling || !user) return;
    if (user.isSubscribed) {
      setPolling(false);
      return;
    }
    if (pollCount.current >= MAX_POLLS) {
      setPolling(false);
      return;
    }
    const timer = setTimeout(() => {
      pollCount.current += 1;
      refresh();
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [polling, user, refresh]);

  async function handleCheckout() {
    setActionError(null);
    setNotConfigured(false);
    setCheckoutPending(true);
    try {
      const { url } = await startCheckout();
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotConfigured(true);
      } else {
        setActionError(err instanceof ApiError ? err.message : "Could not start checkout.");
      }
      setCheckoutPending(false);
    }
  }

  async function handlePortal() {
    setActionError(null);
    setNotConfigured(false);
    setPortalPending(true);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setNotConfigured(true);
      } else {
        setActionError(err instanceof ApiError ? err.message : "Could not open the billing portal.");
      }
      setPortalPending(false);
    }
  }

  if (sessionLoading) return null;

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-display text-2xl font-semibold text-stone-900">Billing</h1>
        <p className="mt-3 text-sm text-stone-600">Log in to see your plan and manage billing.</p>
        <Link
          href="/login?next=/billing"
          className="mt-6 inline-block rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600"
        >
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-2xl font-semibold text-stone-900">Billing</h1>

      {status === "cancelled" && (
        <p className="mt-4 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">
          Checkout was cancelled. No changes were made to your account.
        </p>
      )}

      {polling && !user.isSubscribed && (
        <p className="mt-4 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-800">
          Finishing up your subscription… this usually takes just a few seconds.
        </p>
      )}

      <div className="mt-6 surface-flat p-5">
        {user.isAdmin ? (
          <>
            <p className="text-sm font-semibold text-stone-900">Site owner</p>
            <p className="mt-2 text-sm text-stone-600">
              This account gets unlimited triage agent runs, always. There is nothing to subscribe to
              or manage here.
            </p>
          </>
        ) : user.isSubscribed ? (
          <>
            <p className="text-sm font-semibold text-stone-900">Pro plan: $19.99/month</p>
            <p className="mt-2 text-sm text-stone-600">Unlimited triage agent runs.</p>
            <button
              type="button"
              onClick={handlePortal}
              disabled={portalPending}
              className="mt-4 rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
            >
              {portalPending ? "Opening…" : "Manage billing"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-stone-900">Free tier</p>
            <p className="mt-2 text-sm text-stone-600">
              {user.requestsRemaining !== null && user.requestsRemaining > 0
                ? `${user.requestsUsed} of ${FREE_REQUEST_LIMIT} free triage runs used. ${user.requestsRemaining} remaining.`
                : `You've used all ${FREE_REQUEST_LIMIT} free triage runs.`}
            </p>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={checkoutPending}
              className="mt-4 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
            >
              {checkoutPending ? "Redirecting…" : "Upgrade: $19.99/month"}
            </button>
          </>
        )}

        {notConfigured && <NotConfiguredNotice />}
        {actionError && <p className="mt-3 text-sm text-rose-600">{actionError}</p>}
      </div>
    </div>
  );
}
