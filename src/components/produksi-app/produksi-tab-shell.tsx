"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import { ProduksiBaruForm } from "@/components/produksi-app/produksi-baru-form";
import { WarehouseView } from "@/components/produksi-app/warehouse-view";
import { ProfilView } from "@/components/produksi-app/profil-view";
import { ProduksiBottomNav } from "@/components/produksi-app/bottom-nav";
import {
  getDraftJadwalForProduksiAction,
  getWarehouseMapAction,
  getMesinListAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export type ProduksiTabKey = "kartu-pengiriman" | "produksi-baru" | "warehouse" | "profil";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  "kartu-pengiriman": "/mkesindo/produksi-app",
  "produksi-baru": "/mkesindo/produksi-app/produksi-baru",
  warehouse: "/mkesindo/produksi-app/warehouse",
  profil: "/mkesindo/produksi-app/profil",
};

export function ProduksiTabShell({
  initialTab,
  userName,
  initialKartuPengiriman,
  initialWarehouse,
  initialMesin,
}: {
  initialTab: ProduksiTabKey;
  userName: string;
  initialKartuPengiriman?: DraftJadwalForProduksi[];
  initialWarehouse?: PalletPosisiRow[];
  initialMesin?: MesinRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiTabKey>>(() => new Set([initialTab]));

  const [kartuPengiriman, setKartuPengiriman] = useState<DraftJadwalForProduksi[] | null>(initialKartuPengiriman ?? null);
  const [warehouse, setWarehouse] = useState<PalletPosisiRow[] | null>(initialWarehouse ?? null);
  const [mesin, setMesin] = useState<MesinRow[] | null>(initialMesin ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshKartuPengiriman() {
    setKartuPengiriman(null);
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
      if ((activeTab === "produksi-baru" || activeTab === "warehouse") && warehouse === null) {
        setLoadingTab(activeTab);
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
      if (activeTab === "produksi-baru" && mesin === null) {
        setLoadingTab("produksi-baru");
        const result = await getMesinListAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setMesin(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // kartuPengiriman/warehouse/mesin are deliberately in the dependency
    // list, not just activeTab: refreshKartuPengiriman/refreshWarehouse
    // reset the relevant state to null WITHOUT changing activeTab (a save
    // action's onAfter callback fires while the user is still on that same
    // tab), and this effect must re-run to refetch in that case, not only
    // when the user switches tabs.
  }, [activeTab, kartuPengiriman, warehouse, mesin]);

  return (
    <div className="flex h-dvh flex-col bg-background">
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
              onAfterMuat={() => {
                refreshKartuPengiriman();
                refreshWarehouse();
              }}
            />
          </div>
        )}
        {visited.has("produksi-baru") && warehouse && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "produksi-baru" && "hidden")}>
            <ProduksiBaruForm mesinList={mesin} posisi={warehouse} onAfterSimpan={refreshWarehouse} />
          </div>
        )}
        {visited.has("warehouse") && warehouse && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView posisi={warehouse} />
          </div>
        )}
        {visited.has("profil") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "profil" && "hidden")}>
            <ProfilView userName={userName} />
          </div>
        )}
      </div>
      <ProduksiBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
