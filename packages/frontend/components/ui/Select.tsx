import { forwardRef, type SelectHTMLAttributes } from "react";

// Same shared treatment as Input.tsx, for the two hand-rolled <select>
// elements this app had (ClinicianDecisionForm's decision picker,
// ScheduleFollowUpForm's method picker), both previously styled with their
// own copy of the identical border/radius/padding string.
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className = "", invalid, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid ? "true" : undefined}
      className={"field-control w-full bg-white text-stone-900 disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400 " + className}
      {...props}
    >
      {children}
    </select>
  );
});
