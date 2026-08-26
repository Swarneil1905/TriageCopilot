import type { Metadata } from "next";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { NavBar } from "@/components/NavBar";
import "./globals.css";

// Deliberately system font stacks, not next/font/google -- a Google Fonts
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
        <DisclaimerBanner />
        <NavBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
