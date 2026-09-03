import type { Metadata } from "next";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { NavBar } from "@/components/NavBar";
import { SessionProvider } from "@/components/SessionProvider";
import { CommandPalette } from "@/components/CommandPalette";
// Self-hosted variable fonts (Space Grotesk for display, Plus Jakarta Sans
// for body/UI text), pulled in as bundled .woff2 files via @fontsource,
// not next/font/google or any CDN <link>. An earlier pass tried
// next/font/google and reverted it after this sandbox's own build could
// not reach fonts.googleapis.com at all, with no way to confirm Railway's
// build step could either. That reasoning was sound for that approach, but
// the actual fix was never "give up on custom type", it was "stop asking
// the build to fetch fonts over the network at all": self-hosting these as
// real npm packages means the .woff2 files are part of the build output
// from this repo's own dependency tree, so there is zero runtime or
// build-time network call to any font provider, on Railway or anywhere
// else. System-stack fallbacks are kept in globals.css regardless, as
// cheap insurance that costs nothing.
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

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
          {/* Mounted once at the root, not per-page, so Cmd+K/Ctrl+K opens
              it from anywhere in the app, not just the dashboard. */}
          <CommandPalette />
          <main>{children}</main>
          <footer className="border-t border-stone-200 bg-white px-6 py-5 text-sm text-stone-500">
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
