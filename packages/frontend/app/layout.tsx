import type { Metadata } from "next";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { NavBar } from "@/components/NavBar";
import { SessionProvider } from "@/components/SessionProvider";
import "./globals.css";

// Deliberately system font stacks, not next/font/google. A Google Fonts
// fetch failure at build time takes the whole production build down with
// it, and that's too much blast radius for a typographic nice-to-have.
// System serif/sans stacks are zero-network-dependency and still read as
// considered rather than default-Tailwind; see the font-family rules in
// globals.css.

export const metadata: Metadata = {
  title: "TriageCopilot",
  description: "Synthetic care-ops prototype: LLM triage agent + human-in-the-loop review.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SessionProvider>
          <DisclaimerBanner />
          <NavBar />
          <main>{children}</main>
          <footer className="border-t border-stone-200 bg-white px-6 py-6 text-sm text-stone-500">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
              <span className="font-mono-data text-xs text-stone-400">
                TriageCopilot. Next.js, Fastify, Postgres, deployed on Railway.
              </span>
              <a
                href="https://github.com/Swarneil1905/TriageCopilot"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal-700 hover:underline"
              >
                View source on GitHub →
              </a>
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
