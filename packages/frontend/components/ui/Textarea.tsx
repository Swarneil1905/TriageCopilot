import { forwardRef, type TextareaHTMLAttributes } from "react";

// Same shared treatment as Input.tsx, for the two hand-rolled <textarea>
// elements this app had (IntakeForm's chief complaint, ClinicianDecisionForm's
// note).
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className = "", invalid, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid ? "true" : undefined}
      className={
        "field-control w-full resize-y bg-white text-stone-900 placeholder:text-stone-400 " +
        "disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 " +
        className
      }
      {...props}
    />
  );
});
