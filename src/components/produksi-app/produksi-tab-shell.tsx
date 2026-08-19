"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import { WarehouseView } from "@/components/produksi-app/warehouse-view";
import { KualitasView } from "@/components/produksi-app/kualitas-view";
import { ProduksiBottomNav } from "@/components/produksi-app/bottom-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";
import {
  getDraftJadwalForProduksiAction,
  getDraftJadwalRiwayatForProduksiAction,
  getSelesaiMuatJadwalForProduksiAction,
  getSelesaiMuatJadwalRiwayatForProduksiAction,
  getWarehouseMapAction,
  getMesinListAction,
  getKualitasRiwayatAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { KualitasRow } from "@/lib/queries/produksi-kualitas";

export type ProduksiTabKey = "kartu-pengiriman" | "riwayat" | "warehouse" | "kualitas";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  riwayat: "/mkesindo/produksi-app/riwayat",
  warehouse: "/mkesindo/produksi-app/warehouse",
  kualitas: "/mkesindo/produksi-app/kualitas",
};

export function ProduksiTabShell({
  initialTab,
  userName,
  profile,
  initialKartuPengiriman,
  initialRiwayat,
  initialWarehouse,
  initialMesin,
  initialKualitas,
}: {
  initialTab: ProduksiTabKey;
  userName: string;
  profile: OwnProfile | null;
  initialKartuPengiriman?: DraftJadwalForProduksi[];
  initialRiwayat?: DraftJadwalForProduksi[];
  initialWarehouse?: PalletPosisiRow[];
  initialMesin?: MesinRow[];
  initialKualitas?: KualitasRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiTabKey>>(() => new Set([initialTab]));

  const [kartuPengiriman, setKartuPengiriman] = useState<DraftJadwalForProduksi[] | null>(initialKartuPengiriman ?? null);
  const [riwayat, setRiwayat] = useState<DraftJadwalForProduksi[] | null>(initialRiwayat ?? null);
  const [warehouse, setWarehouse] = useState<PalletPosisiRow[] | null>(initialWarehouse ?? null);
  const [mesin, setMesin] = useState<MesinRow[] | null>(initialMesin ?? null);
  const [kualitas, setKualitas] = useState<KualitasRow[] | null>(initialKualitas ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshKartuPengiriman() {
    setKartuPengiriman(null);
    // A card completed from the Riwayat tab (a backlogged card someone
    // finally loaded) or moving between periods overnight both change
    // what Riwayat itself should show too, so refresh both lists together
    // rather than tracking which one actually needs it.
    setRiwayat(null);
  }

  function refreshWarehouse() {
    setWarehouse(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
      if (activeTab === "kartu-pengiriman" && kartuPengiriman === null) {
        setLoadingTab("kartu-pengiriman");
        const result = await getDraftJadwalForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setKartuPengiriman(result.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "riwayat" && riwayat === null) {
        setLoadingTab("riwayat");
        const result = await getDraftJadwalRiwayatForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setRiwayat(result.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "warehouse" && warehouse === null) {
        setLoadingTab("warehouse");
        const result = await getWarehouseMapAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setWarehouse(result.data);
        setLoadingTab(null);
      }
      // Warehouse now also needs the Mesin list up front — the click-slot
      // Tambah Produksi dialog is embedded directly in the Warehouse tab
      // (the old separate "Produksi Baru" tab is gone), so both must be
      // loaded before that tab can render its dialog's Mesin picker.
      if (activeTab === "warehouse" && mesin === null) {
        setLoadingTab("warehouse");
        const result = await getMesinListAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setMesin(result.data);
        setLoadingTab(null);
        return;
      }
      // Kualitas also needs the Mesin list for its Tambah Pemeriksaan
      // dialog's Mesin picker — same dual-fetch shape as Warehouse above,
      // just landing directly on this tab instead of via Warehouse first.
      if (activeTab === "kualitas" && mesin === null) {
        setLoadingTab("kualitas");
        const result = await getMesinListAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setMesin(result.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "kualitas" && kualitas === null) {
        setLoadingTab("kualitas");
        const result = await getKualitasRiwayatAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setKualitas(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // kartuPengiriman/warehouse/mesin/kualitas are deliberately in the
    // dependency list, not just activeTab: refreshKartuPengiriman/
    // refreshWarehouse reset the relevant state to null WITHOUT changing
    // activeTab (a save action's onAfter callback fires while the user is
    // still on that same tab), and this effect must re-run to refetch in
    // that case, not only when the user switches tabs.
  }, [activeTab, kartuPengiriman, riwayat, warehouse, mesin, kualitas]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <h1 className="font-display text-base font-semibold">Aplikasi Produksi</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
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
        {visited.has("kartu-pengiriman") && kartuPengiriman && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "kartu-pengiriman" && "hidden")}>
            <KartuPengirimanList
              initialJadwal={kartuPengiriman}
              fetchSelesaiList={getSelesaiMuatJadwalForProduksiAction}
              onAfterMuat={() => {
                refreshKartuPengiriman();
                refreshWarehouse();
              }}
            />
          </div>
        )}
        {visited.has("riwayat") && riwayat && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "riwayat" && "hidden")}>
            <KartuPengirimanList
              initialJadwal={riwayat}
              fetchSelesaiList={getSelesaiMuatJadwalRiwayatForProduksiAction}
              emptyMessage="Tidak ada Kartu Pengiriman periode sebelumnya."
              onAfterMuat={() => {
                refreshKartuPengiriman();
                refreshWarehouse();
              }}
            />
          </div>
        )}
        {visited.has("warehouse") && warehouse && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} mesinList={mesin} onAfterTambah={refreshWarehouse} />
          </div>
        )}
        {visited.has("kualitas") && kualitas && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "kualitas" && "hidden")}>
            <KualitasView initialRiwayat={kualitas} mesinList={mesin} />
          </div>
        )}
      </div>
      <ProduksiBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
