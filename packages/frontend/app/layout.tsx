import type { Metadata } from "next";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import "./globals.css";

export const metadata: Metadata = {
  title: "TriageCopilot",
  description: "Synthetic care-ops prototype: LLM triage agent + human-in-the-loop review.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <DisclaimerBanner />
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <a href="/" className="text-lg font-semibold text-slate-900">
            TriageCopilot
          </a>
          <span className="ml-2 text-sm text-slate-400">care-ops dashboard</span>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
