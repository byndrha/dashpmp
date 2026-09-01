"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { UserMenu } from "@/components/dashboard/user-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";
import { InspeksiPanel } from "@/components/satpam-app/inspeksi-panel";
import { ComingSoonPanel } from "@/components/satpam-app/coming-soon-panel";
import { SatpamBottomNav } from "@/components/satpam-app/satpam-bottom-nav";
import type { SatpamInspectionCard, SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";

export type SatpamTabKey = "inspeksi" | "patroli" | "tamu";

const TAB_PATHS: Record<SatpamTabKey, string> = {
  inspeksi: "/mkesindo/satpam-app",
  patroli: "/mkesindo/satpam-app/patroli",
  tamu: "/mkesindo/satpam-app/tamu",
};

// Keep-alive tab shell mirroring DriverTabShell/ProduksiTabShell -- every
// tab visited so far stays mounted (CSS `hidden` toggling, never actual
// unmount), so switching back to one already visited is instant. Tab
// switches deliberately never touch Next.js's router; the URL is kept
// cosmetically in sync via history.replaceState only.
export function SatpamTabShell({
  initialTab,
  userName,
  profile,
  initialCards,
  initialTimeline,
}: {
  initialTab: SatpamTabKey;
  userName: string;
  profile: OwnProfile | null;
  initialCards: SatpamInspectionCard[];
  initialTimeline: SatpamTimelineEntry[];
}) {
  const [activeTab, setActiveTab] = useState<SatpamTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<SatpamTabKey>>(() => new Set([initialTab]));

  function handleChangeTab(tab: SatpamTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <h1 className="font-display text-base font-semibold">Aplikasi Satpam</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {visited.has("inspeksi") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "inspeksi" && "hidden")}>
            <InspeksiPanel cards={initialCards} timeline={initialTimeline} active={activeTab === "inspeksi"} />
          </div>
        )}
        {visited.has("patroli") && (
          <div className={cn("h-full", activeTab !== "patroli" && "hidden")}>
            <ComingSoonPanel title="Patroli" />
          </div>
        )}
        {visited.has("tamu") && (
          <div className={cn("h-full", activeTab !== "tamu" && "hidden")}>
            <ComingSoonPanel title="Tamu" />
          </div>
        )}
      </div>
      <SatpamBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
