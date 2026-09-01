"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { logOut, type SessionUser } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";

// Kept as one small function rather than duplicating this branching inline
// in both the desktop and mobile nav blocks below, since it's genuinely the
// same three-way state (admin / subscribed / free-tier-with-a-count) either
// place shows it.
function usageLabel(user: SessionUser): string {
  if (user.isAdmin) return "Admin";
  if (user.isSubscribed) return "Pro";
  const remaining = user.requestsRemaining ?? 0;
  return remaining > 0 ? `${remaining} free run${remaining === 1 ? "" : "s"} left` : "Free runs used up";
}

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/product-notes", label: "Product notes" },
] as const;

// A patient detail page (/patients/[id]) isn't one of the top-level nav
// destinations, but it's part of the Dashboard section, so highlight
// "Dashboard" as active there too rather than showing no active state.
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/patients");
  return pathname === href;
}

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // A sticky bar that stays flat white at the very top of the page, then
  // picks up a translucent, blurred background once the page has actually
  // scrolled underneath it, the same subtle "considered" treatment both
  // Nabla and Abridge use on their own nav bars.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile panel automatically on navigation, so it never gets
  // left open pointing at a page the visitor already left.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await logOut();
    await refresh();
    router.refresh();
    setMobileOpen(false);
  }

  return (
    <header
      className={
        "sticky top-0 z-40 border-b border-stone-200 transition-colors " +
        (scrolled ? "bg-white/80 backdrop-blur-md" : "bg-white")
      }
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display tracking-display shrink-0 text-lg font-semibold text-stone-900">
          TriageCopilot
        </Link>

        {/* Full nav: logo left, links + auth right, only from md up. Below
            that, the hamburger button takes over (both reference sites use
            exactly this split rather than letting the full nav wrap). */}
        <div className="hidden items-center gap-x-4 md:flex">
          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    "border-b-2 px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 " +
                    (active
                      ? "border-teal-600 text-stone-900"
                      : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-900")
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-2 border-l border-stone-200 pl-4 text-sm">
            {loading ? null : user ? (
              <>
                <Link
                  href="/billing"
                  className={
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap " +
                    (user.isAdmin || user.isSubscribed
                      ? "bg-teal-50 text-teal-700 hover:bg-teal-100"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200")
                  }
                >
                  {usageLabel(user)}
                </Link>
                <span className="max-w-[140px] truncate text-stone-500" title={user.email}>
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="shrink-0 rounded-lg px-2 py-1 font-medium whitespace-nowrap text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="shrink-0 font-medium whitespace-nowrap text-stone-600 hover:text-stone-900"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="shrink-0 rounded-lg bg-stone-900 px-2.5 py-1 font-medium whitespace-nowrap text-white hover:bg-stone-700"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Hamburger, below md only. */}
        <button
          type="button"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu panel: full link list, then the auth block, stacked. */}
      {mobileOpen && (
        <div className="border-t border-stone-200 bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    "rounded-lg px-3 py-2 text-sm font-medium " +
                    (active
                      ? "bg-stone-100 text-stone-900"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900")
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 flex items-center gap-3 border-t border-stone-200 pt-3 text-sm">
            {loading ? null : user ? (
              <>
                <Link
                  href="/billing"
                  className={
                    "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium " +
                    (user.isAdmin || user.isSubscribed
                      ? "bg-teal-50 text-teal-700 hover:bg-teal-100"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200")
                  }
                >
                  {usageLabel(user)}
                </Link>
                <span className="flex-1 truncate text-stone-500" title={user.email}>
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg px-2 py-1 font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="font-medium text-stone-600 hover:text-stone-900">
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-700"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
