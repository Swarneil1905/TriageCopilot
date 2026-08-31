"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, getHealth, runLiveDemo, type PatientWorldState } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";
import { AgentReasoningPanel } from "@/components/AgentReasoningPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { RiskBadge } from "@/components/RiskBadge";

/** The interactive half of the landing page's "watch the AI agent reason"
 * section: gated on login (an anonymous, un-gated button that triggers a
 * real LLM call is a standing invitation to run up the site owner's API
 * bill, see the 0002 migration's header comment), and renders the run's
 * actual reasoning trace inline once it completes. */
export function LiveDemoRunner() {
  const { user, loading: sessionLoading } = useSession();
  const [llmProvider, setLlmProvider] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PatientWorldState | null>(null);

  useEffect(() => {
    getHealth()
      .then((h) => setLlmProvider(h.llmProvider))
      .catch(() => undefined);
  }, []);

  async function handleRun() {
    setPending(true);
    setError(null);
    try {
      const state = await runLiveDemo();
      setResult(state);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the backend.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-stone-900">Run it yourself, right now</h3>
          <p className="mt-1 max-w-xl text-sm text-stone-600">
            Creates a fresh synthetic patient with a randomized intake and runs the real triage agent above against
            it, live, using whatever model is currently configured.
          </p>
        </div>

        {sessionLoading ? null : user ? (
          <button
            type="button"
            onClick={handleRun}
            disabled={pending}
            className="shrink-0 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
          >
            {pending ? "Agent is running…" : "Run a live triage now"}
          </button>
        ) : (
          <Link
            href="/login?next=/"
            className="shrink-0 rounded-md border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
          >
            Log in to run it
          </Link>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

      {result && (
        <div className="mt-5 border-t border-stone-200 pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-stone-900">{result.displayName}</span>
            <StatusBadge status={result.status} />
            <RiskBadge riskLevel={result.riskLevel} />
            <Link href={`/patients/${result.patientId}`} className="text-sm font-medium text-teal-700 hover:underline">
              View full patient page →
            </Link>
          </div>
          <AgentReasoningPanel events={result.events} llmProvider={llmProvider} />
        </div>
      )}
    </div>
  );
}
