// One shared label treatment, reused everywhere a form field needs one:
// signup/login, new-patient, and all four ActionPanel forms used to each
// hand-type the identical "block text-sm font-medium text-stone-700"
// string separately. A single source now, so a future tweak to label
// styling happens once instead of five times in five files.
export function Label({
  htmlFor,
  children,
  className = "",
}: {
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-medium text-stone-700 ${className}`}>
      {children}
    </label>
  );
}
