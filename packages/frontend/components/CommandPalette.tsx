"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { getPatients, type PatientWorldState } from "@/lib/api";

/** Global Cmd+K / Ctrl+K command palette, mounted once in the root layout
 * (not per-page) so it works from anywhere in the app, per Twenty/Linear/
 * Cal.com's own command palettes: jump straight to any patient by partial
 * name match, or run one of a couple of obvious actions. Built on cmdk, the
 * same lightweight headless library those real products' own palettes use,
 * rather than hand-rolling fuzzy-match/keyboard-nav logic from scratch. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [patients, setPatients] = useState<PatientWorldState[] | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Loaded lazily on first open rather than eagerly on every page mount:
  // this dataset is small and rarely stale mid-session, so a fetch each
  // time the palette opens keeps it fresh without adding a global data
  // layer just for this.
  useEffect(() => {
    if (!open) return;
    getPatients()
      .then(setPatients)
      .catch(() => setPatients([]));
  }, [open]);

  function go(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed top-[18vh] left-1/2 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl shadow-stone-900/20"
    >
      <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-stone-400">
          <circle cx="11" cy="11" r="7" />
          <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
        </svg>
        <Command.Input
          autoFocus
          placeholder="Jump to a patient, or run a command…"
          className="w-full bg-transparent py-1 text-sm text-stone-900 outline-none placeholder:text-stone-400"
        />
        <kbd className="hidden shrink-0 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[10px] text-stone-400 sm:inline">
          Esc
        </kbd>
      </div>

      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-stone-400">
          No matches.
        </Command.Empty>

        <Command.Group heading="Actions" className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-stone-400 uppercase [&_[cmdk-group-items]]:mt-1">
          <Command.Item
            onSelect={() => go("/dashboard?new=1")}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 data-[selected=true]:bg-teal-50 data-[selected=true]:text-teal-800"
          >
            + New synthetic patient
          </Command.Item>
          <Command.Item
            onSelect={() => go("/dashboard")}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 data-[selected=true]:bg-teal-50 data-[selected=true]:text-teal-800"
          >
            Go to dashboard
          </Command.Item>
        </Command.Group>

        {patients && patients.length > 0 && (
          <Command.Group heading="Patients" className="px-1 pt-2 text-[11px] font-semibold tracking-wide text-stone-400 uppercase [&_[cmdk-group-items]]:mt-1">
            {patients.map((p) => (
              <Command.Item
                key={p.patientId}
                value={p.displayName}
                onSelect={() => go(`/patients/${p.patientId}`)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 data-[selected=true]:bg-teal-50 data-[selected=true]:text-teal-800"
              >
                <span className="truncate">{p.displayName}</span>
                <span className="font-mono-data shrink-0 text-[11px] text-stone-400">{p.status.replace(/_/g, " ")}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
