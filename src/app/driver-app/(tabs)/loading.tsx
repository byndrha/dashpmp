import { Loader2 } from "lucide-react";

// Next.js's route-segment loading convention: this becomes the Suspense
// fallback for whatever page is rendering under (tabs)/layout.tsx, shown
// INSTANTLY the moment a tab is tapped — the layout itself (and so the
// bottom nav) is never unmounted/re-rendered across tabs, only this
// segment's own content area swaps to this fallback while the destination
// page's server-side data fetch (getDriverJadwalList, getDriverJadwalStops,
// etc.) is still in flight. Without this file, Next.js has no fallback to
// show and the UI just sits frozen on the previous tab until the new
// page's entire data fetch resolves — this is what "loading lama, tidak
// instan" actually was: a missing loading state, not a slower app.
export default function DriverTabsLoading() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}
