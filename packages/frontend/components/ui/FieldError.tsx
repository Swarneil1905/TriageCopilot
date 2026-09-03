// One shared error-message treatment. Replaces the near-identical
// "mt-2 text-sm text-rose-600" ErrorText this app used to define locally
// inside ActionPanel.tsx, plus the hand-typed rose-600 paragraphs in
// AuthForm.tsx and NewPatientForm.tsx: same rendering, one place.
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1.5 text-sm text-rose-600">{message}</p>;
}
