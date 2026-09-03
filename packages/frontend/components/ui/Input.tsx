import { forwardRef, type InputHTMLAttributes } from "react";

// The one shared text-input control for the whole app. Before this, every
// form (signup, login, new-patient, and all three ActionPanel forms that
// use a plain <input>) hand-typed its own copy of
// "rounded-md border border-stone-300 px-2 py-1.5 text-sm", five separate
// times, with no keyboard focus-visible state anywhere in the app. The
// .field-control class (globals.css) carries the shared border/radius/
// padding/focus-ring/invalid-state rules; this component just wires props
// through to it consistently.
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className = "", invalid, ...props }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid ? "true" : undefined}
      className={
        "field-control w-full bg-white text-stone-900 placeholder:text-stone-400 " +
        "disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 " +
        className
      }
      {...props}
    />
  );
});
