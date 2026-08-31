"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, type SessionUser } from "@/lib/api";

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * A single, shared session check (GET /api/auth/me), mounted once in the
 * root layout. NavBar, the landing page's live-demo section, and the
 * login/signup forms all read from this one context instead of each
 * running their own independent useEffect -- otherwise a client-side
 * navigation right after signup/login leaves NavBar (which persists across
 * that navigation and never remounts) showing "Log in" until a full page
 * reload, since nothing would tell its own separate fetch to re-run. This
 * was a real bug caught while running scripts/verify-ui.mjs: the live-demo
 * button correctly reflected a fresh login on the page it lived on, but the
 * NavBar right next to it didn't.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await getSession());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ user, loading, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
