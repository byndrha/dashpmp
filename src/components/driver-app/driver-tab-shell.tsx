"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBusinessDateISO } from "@/lib/business-date";
import { TugasList } from "@/components/driver-app/tugas-list";
import { PetaOverviewMap } from "@/components/driver-app/peta-overview-map";
import { DriverBottomNav } from "@/components/driver-app/bottom-nav";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { UserMenu } from "@/components/dashboard/user-menu";
import {
  getDriverJadwalListAction,
  getDriverJadwalStopsAction,
  getOwnDriverProfileAction,
  getPabrikLocationForDriverAction,
} from "@/app/mkesindo/driver-app/actions";
import type { DriverJadwalCard, DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import type { DriverProfileRow } from "@/lib/queries/driver-profile";

export type DriverTabKey = "tugas" | "peta";

interface TugasData {
  dateISO: string;
  jadwal: DriverJadwalCard[];
}

interface PetaRoute {
  jadwalId: number;
  stops: DriverStopRow[];
}

interface PetaData {
  pabrik: { lat: number; lng: number };
  routes: PetaRoute[];
}

const TAB_PATHS: Record<DriverTabKey, string> = {
  tugas: "/mkesindo/driver-app",
  peta: "/mkesindo/driver-app/peta",
};

// Keep-alive tab shell: every tab visited so far stays mounted (CSS `hidden`
// toggling), so switching back to one already visited is instant with zero
// network round-trip — a real <Link> navigation would force a fresh Server
// Component render/fetch every time, which was the "loadingnya lama" (feels
// slow) complaint this shell exists to fix. Tab switches deliberately never
// touch Next.js's router; the URL is kept cosmetically in sync via
// history.replaceState only, so the browser's address bar/back button still
// reflect the active tab without triggering any navigation.
//
// Only 2 tabs now (Tugas, Peta) — Riwayat and Profil are no longer
// bottom-nav tabs: Riwayat is a plain drill-down route reached via a button
// on the Tugas screen (see riwayat/page.tsx, riwayat-view.tsx), and Profil
// is now an inline panel inside the Tugas screen itself (tugas-list.tsx).
export function DriverTabShell({
  initialTab,
  driverName,
  driverProfile: initialDriverProfile,
  initialTugas,
  initialPeta,
  initialError,
}: {
  initialTab: DriverTabKey;
  driverName: string;
  // Only ever passed eagerly by the Tugas page (the usual landing tab) —
  // undefined here means "not fetched yet", lazily filled in below the
  // same way `tugas`/`peta` are, for a driver who deep-links straight into
  // /peta instead.
  driverProfile?: DriverProfileRow | null;
  initialTugas?: TugasData;
  initialPeta?: PetaData;
  // Set by a page when the account has no linked salesmanId — same message
  // every lazy tab-switch would surface anyway (requireOwnSalesmanId throws
  // it), just shown immediately for the initially-loaded tab instead of
  // waiting for a switch.
  initialError?: string;
}) {
  const [activeTab, setActiveTab] = useState<DriverTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<DriverTabKey>>(() => new Set([initialTab]));

  const [tugas, setTugas] = useState<TugasData | null>(initialTugas ?? null);
  const [peta, setPeta] = useState<PetaData | null>(initialPeta ?? null);
  // undefined = not fetched yet, null = fetched, account has no linked profile.
  const [driverProfile, setDriverProfile] = useState<DriverProfileRow | null | undefined>(initialDriverProfile);

  const [loadingTab, setLoadingTab] = useState<DriverTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(initialError ?? null);

  function handleChangeTab(tab: DriverTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  // Fires once per tab switch. Each branch's own null/undefined check means
  // a tab already holding data (the initial route's tab, or one visited
  // before) is a no-op here — this is what makes repeat visits instant.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setTabError(null);

      if (activeTab === "tugas" && (tugas === null || driverProfile === undefined)) {
        setLoadingTab("tugas");
        const dateISO = getBusinessDateISO();
        const [jadwalResult, profileResult] = await Promise.all([
          tugas === null ? getDriverJadwalListAction(dateISO) : Promise.resolve({ success: true as const, data: tugas.jadwal }),
          driverProfile === undefined ? getOwnDriverProfileAction() : Promise.resolve({ success: true as const, data: driverProfile }),
        ]);
        if (cancelled) return;
        if (!jadwalResult.success) {
          setTabError(jadwalResult.error);
          setLoadingTab(null);
          return;
        }
        if (!profileResult.success) {
          setTabError(profileResult.error);
          setLoadingTab(null);
          return;
        }
        setTugas({ dateISO, jadwal: jadwalResult.data });
        setDriverProfile(profileResult.data);
        setLoadingTab(null);
        return;
      }

      if (activeTab === "peta" && peta === null) {
        setLoadingTab("peta");
        const pabrikResult = await getPabrikLocationForDriverAction();
        if (cancelled) return;
        if (!pabrikResult.success) {
          setTabError(pabrikResult.error);
          setLoadingTab(null);
          return;
        }
        const dateISO = getBusinessDateISO();
        const jadwalResult = await getDriverJadwalListAction(dateISO);
        if (cancelled) return;
        if (!jadwalResult.success) {
          setTabError(jadwalResult.error);
          setLoadingTab(null);
          return;
        }
        const routes = await Promise.all(
          jadwalResult.data.map(async (j) => {
            const stopsResult = await getDriverJadwalStopsAction(j.JadwalID);
            return { jadwalId: j.JadwalID, stops: stopsResult.success ? stopsResult.data : [] };
          })
        );
        if (cancelled) return;
        setPeta({
          pabrik: { lat: pabrikResult.data.latitude, lng: pabrikResult.data.longitude },
          routes,
        });
        setLoadingTab(null);
        return;
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Only re-run on tab switch — each branch's own state check (tugas ===
    // null, etc.) is what decides whether a fetch is actually needed, not
    // this dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* No border/divider under the header, deliberately -- just the
          account button + theme toggle floated to the top-right corner. */}
      <header className="flex items-center justify-end gap-1 px-3 py-2">
        <AppearanceMenu />
        <UserMenu name={driverName} profile={null} />
      </header>
      <div className="relative min-h-0 flex-1">
        {loadingTab && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {tabError && (
          <p className="absolute inset-x-4 top-4 z-10 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {tabError}
          </p>
        )}

        {visited.has("tugas") && tugas && driverProfile !== undefined && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "tugas" && "hidden")}>
            <TugasList initialJadwal={tugas.jadwal} initialDateISO={tugas.dateISO} driverProfile={driverProfile} driverName={driverName} />
          </div>
        )}
        {visited.has("peta") && peta && (
          <div className={cn("h-full", activeTab !== "peta" && "hidden")}>
            <PetaOverviewMap pabrik={peta.pabrik} routes={peta.routes} />
          </div>
        )}
      </div>
      <DriverBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
