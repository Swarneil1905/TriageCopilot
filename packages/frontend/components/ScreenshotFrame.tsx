// A single, reusable "here is real product UI" device, extracted from what
// was previously one-off browser chrome markup inside the "Watch the AI
// agent reason" section: three traffic light dots and a real address bar
// showing the actual route the content lives at, wrapped around either a
// live component or a static screenshot. Round two of the design revamp
// found three different treatments for product proof on the same landing
// page (an unframed image in the hero, this browser chrome, and a plain
// bordered image further down); standardizing on this one component, used
// everywhere a real screenshot or a real live component appears, is the
// fix. The address bar always takes a real route on this instance, never a
// placeholder, so the frame itself stays honest about what it is showing.
export function ScreenshotFrame({
  route,
  children,
  contentClassName = "p-4",
}: {
  route: string;
  children: React.ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm shadow-stone-900/5">
      <div className="flex items-center gap-3 border-b border-stone-100 bg-stone-100/70 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </div>
        <span className="font-mono-data truncate rounded border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-500">
          {route}
        </span>
      </div>
      <div className={contentClassName}>{children}</div>
    </div>
  );
}
