"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <header className="border-b border-stone-200 bg-white px-6 py-3">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link href="/" className="font-display text-lg font-semibold text-stone-900">
          TriageCopilot
        </Link>

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
      </div>
    </header>
  );
}
