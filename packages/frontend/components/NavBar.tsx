"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logOut } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";

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

  async function handleLogout() {
    await logOut();
    await refresh();
    router.refresh();
  }

  return (
    <header className="border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2">
        <Link href="/" className="font-display shrink-0 text-lg font-semibold text-stone-900">
          TriageCopilot
        </Link>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <nav className="flex flex-wrap items-center gap-1">
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
                <span className="max-w-[140px] truncate text-stone-500" title={user.email}>
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="shrink-0 rounded-md px-2 py-1 font-medium whitespace-nowrap text-stone-600 hover:bg-stone-50 hover:text-stone-900"
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
                  className="shrink-0 rounded-md bg-stone-900 px-2.5 py-1 font-medium whitespace-nowrap text-white hover:bg-stone-700"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
