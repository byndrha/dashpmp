// Tiny in-page pub/sub so a successful "Tambah Kunjungan" confirmation
// (TambahKunjunganSheet, mounted once at the pemasaran-app tab shell level —
// a SIBLING of the Beranda/Kinerja Marketing tabs, not their parent, see
// pemasaran-app-tab-shell.tsx) can tell those already-mounted tabs to
// refetch their own data.
//
// Why this exists instead of relying on revalidatePath alone: this whole
// marketing-app surface is client components calling Server Actions
// directly from useEffect on mount (see beranda-tab.tsx /
// kinerja-marketing-sub-tab.tsx), not page-level RSC props — and the tab
// shell keeps every visited tab mounted client-side afterwards (the same
// keep-alive pattern documented for the Aplikasi Driver tab shell), so a rep
// who confirms a visit while already on Beranda or Kinerja Marketing would
// otherwise see stale data (no checkmark, no updated snippet) until a full
// page reload — revalidatePath only invalidates the Next.js Router Cache
// for a path, it does not reach a client component's own already-populated
// useState (final review Finding 2). This module closes that gap directly,
// with far smaller blast radius than lifting data-fetching up into a shared
// parent or restructuring the tab shell.
type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyKunjunganConfirmed(): void {
  for (const listener of listeners) listener();
}

export function subscribeKunjunganConfirmed(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
