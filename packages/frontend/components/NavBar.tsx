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
// destinations, but it's part of the Dashboard section -- highlight
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
    <header className="border-b border-stone-200 bg-white px-6 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="font-display text-lg font-semibold text-stone-900">
          TriageCopilot
        </Link>

        <div className="flex items-center gap-4">
          <nav className="flex items-center gap-1">
            {LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                    (active
                      ? "bg-teal-50 text-teal-800"
                      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900")
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 border-l border-stone-200 pl-4 text-sm">
            {loading ? null : user ? (
              <>
                <span className="text-stone-500">{user.email}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-md px-2 py-1 font-medium text-stone-600 hover:bg-stone-50 hover:text-stone-900"
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
                  className="rounded-md bg-stone-900 px-2.5 py-1 font-medium text-white hover:bg-stone-700"
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
