// Next's own loading.tsx convention: automatically shown while the async
// server component in page.tsx is still awaiting getPatients(), so the
// route never flashes from nothing straight to a fully-loaded table (or
// stays visually blank) while the request is in flight. Kept as a real
// skeleton shaped like the eventual table, not a spinner, so there's no
// layout jump once the real rows arrive (the same "skeleton rows instead of
// a layout jump" idea Cal.com's own bookings list uses).
function SkeletonRow() {
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="h-4 w-32 animate-pulse rounded bg-stone-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-24 animate-pulse rounded-full bg-stone-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-20 animate-pulse rounded-full bg-stone-200" />
      </td>
      <td className="px-4 py-3">
        <div className="h-4 w-28 animate-pulse rounded bg-stone-200" />
      </td>
    </tr>
  );
}

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">Patients</h1>
        <div className="h-8 w-40 animate-pulse rounded-md bg-stone-200" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-stone-200" />
        <div className="h-6 w-64 animate-pulse rounded-full bg-stone-100" />
      </div>

      <div className="surface-flat overflow-hidden">
        <table className="min-w-full divide-y divide-stone-200 text-sm">
          <thead className="bg-stone-50 text-left text-xs font-medium uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2">Patient</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Risk</th>
              <th className="px-4 py-2">Last updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </tbody>
        </table>
      </div>
    </div>
  );
}
