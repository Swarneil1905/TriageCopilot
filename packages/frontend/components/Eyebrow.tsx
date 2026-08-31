// A small uppercase, tracked-out label with a colored dot marker, sitting
// above a section heading. This is the "eyebrow" pattern both Abridge
// ("OUR IMPACT", "ENTERPRISE-GRADE AI") and Nabla use above nearly every
// section headline, tying a page together as one visual language. Uses the
// rust accent color, which this app reserves for small editorial marks
// like this one, never for status/risk semantics or primary CTAs.
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rust" />
      {children}
    </p>
  );
}
