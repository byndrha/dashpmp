"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WarehouseView } from "@/components/produksi-app/warehouse-view";
import { TakeAwayMuatanList } from "@/components/produksi-app/takeaway-muatan-list";
import { KualitasView } from "@/components/produksi-app/kualitas-view";
import { BahanBakuView } from "@/components/produksi-app/bahan-baku-view";
import { AktivitasProduksiView } from "@/components/produksi-app/aktivitas-produksi-view";
import { ProduksiBottomNav } from "@/components/produksi-app/bottom-nav";
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";
import {
  getDraftJadwalForProduksiAction,
  getWarehouseMapAction,
  getMesinListAction,
  getTakeAwayMuatanPendingAction,
  getTakeAwayMuatanSelesaiAction,
  getKualitasRiwayatAction,
  getCurrentShiftRowsForProduksiAction,
  getCurrentAktivitasProduksiAction,
  getAktivitasRiwayatAction,
  getMesinEventsForShiftAction,
  getStafOperasionalOptionsAction,
  getAllTimAction,
  getTimSayaAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { TakeAwayMuatanPendingRow } from "@/lib/queries/takeaway-muatan";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { KualitasRow } from "@/lib/queries/produksi-kualitas";
import type { StokBahanBakuRow, CurrentShiftInfo } from "@/lib/queries/stok-bahan-baku";
import type { AktivitasShiftInfo, QtyRecap, SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
import type { MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { TimRow, AnggotaTimRow } from "@/lib/queries/tim-produksi";

export type ProduksiTabKey = "warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi";

const TAB_PATHS: Record<ProduksiTabKey, string> = {
  warehouse: "/mkesindo/produksi-app",
  kualitas: "/mkesindo/produksi-app/kualitas",
  "bahan-baku": "/mkesindo/produksi-app/bahan-baku",
  "aktivitas-produksi": "/mkesindo/produksi-app/aktivitas-produksi",
};

export function ProduksiTabShell({
  initialTab,
  userName,
  profile,
  initialWarehouse,
  initialMesin,
  initialTakeAwayPending,
  initialWarehouseJadwal,
  initialKualitas,
  initialBahanBaku,
  initialAktivitasProduksi,
}: {
  initialTab: ProduksiTabKey;
  userName: string;
  profile: OwnProfile | null;
  initialWarehouse?: PalletPosisiRow[];
  initialMesin?: MesinRow[];
  initialTakeAwayPending?: TakeAwayMuatanPendingRow[];
  initialWarehouseJadwal?: DraftJadwalForProduksi[];
  initialKualitas?: KualitasRow[];
  initialBahanBaku?: { current: CurrentShiftInfo; rows: StokBahanBakuRow[]; history: StokBahanBakuRow[] };
  initialAktivitasProduksi?: {
    current: AktivitasShiftInfo;
    qty: QtyRecap;
    susunanTim: SusunanTimRow[];
    stafOperasionalNama: string | null;
    kepalaNama: string | null;
    wakilKepalaNama: string | null;
    mesinList: MesinRow[];
    mesinEvents: MesinEventRow[];
    stafOperasionalOptions: StafOperasionalOption[];
    timList: TimRow[];
    timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
    riwayat: AktivitasShiftInfo[];
  };
}) {
  const [activeTab, setActiveTab] = useState<ProduksiTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiTabKey>>(() => new Set([initialTab]));

  const [warehouse, setWarehouse] = useState<PalletPosisiRow[] | null>(initialWarehouse ?? null);
  const [mesin, setMesin] = useState<MesinRow[] | null>(initialMesin ?? null);
  const [takeAwayPending, setTakeAwayPending] = useState<TakeAwayMuatanPendingRow[] | null>(initialTakeAwayPending ?? null);
  const [warehouseJadwal, setWarehouseJadwal] = useState<DraftJadwalForProduksi[] | null>(initialWarehouseJadwal ?? null);
  const [kualitas, setKualitas] = useState<KualitasRow[] | null>(initialKualitas ?? null);
  const [bahanBaku, setBahanBaku] = useState<{ current: CurrentShiftInfo; rows: StokBahanBakuRow[]; history: StokBahanBakuRow[] } | null>(
    initialBahanBaku ?? null
  );
  const [aktivitasProduksi, setAktivitasProduksi] = useState(initialAktivitasProduksi ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshWarehouse() {
    setWarehouse(null);
    setWarehouseJadwal(null);
  }

  function refreshTakeAway() {
    setTakeAwayPending(null);
  }

  function refreshBahanBaku() {
    setBahanBaku(null);
  }

  function refreshAktivitasProduksi() {
    setAktivitasProduksi(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
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
      if (activeTab === "warehouse" && takeAwayPending === null) {
        setLoadingTab("warehouse");
        const result = await getTakeAwayMuatanPendingAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setTakeAwayPending(result.data);
        setLoadingTab(null);
      }
      if (activeTab === "warehouse" && warehouseJadwal === null) {
        setLoadingTab("warehouse");
        const result = await getDraftJadwalForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setWarehouseJadwal(result.data);
        setLoadingTab(null);
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
      if (activeTab === "bahan-baku" && bahanBaku === null) {
        setLoadingTab("bahan-baku");
        const result = await getCurrentShiftRowsForProduksiAction();
        if (cancelled) return;
        if (!result.success) {
          setTabError(result.error);
          setLoadingTab(null);
          return;
        }
        setBahanBaku(result.data);
        setLoadingTab(null);
      }
      if (activeTab === "aktivitas-produksi" && aktivitasProduksi === null) {
        setLoadingTab("aktivitas-produksi");
        const [aktivitasResult, mesinResult, riwayatResult, timListResult, timSayaResult] = await Promise.all([
          getCurrentAktivitasProduksiAction(),
          getMesinListAction(),
          getAktivitasRiwayatAction(),
          getAllTimAction(),
          getTimSayaAction(),
        ]);
        if (cancelled) return;
        if (!aktivitasResult.success) {
          setTabError(aktivitasResult.error);
          setLoadingTab(null);
          return;
        }
        if (!mesinResult.success) {
          setTabError(mesinResult.error);
          setLoadingTab(null);
          return;
        }
        if (!riwayatResult.success) {
          setTabError(riwayatResult.error);
          setLoadingTab(null);
          return;
        }
        if (!timListResult.success) {
          setTabError(timListResult.error);
          setLoadingTab(null);
          return;
        }
        if (!timSayaResult.success) {
          setTabError(timSayaResult.error);
          setLoadingTab(null);
          return;
        }
        const [eventsResult, stafResult] = await Promise.all([
          getMesinEventsForShiftAction(aktivitasResult.data.current.tanggalUsaha, aktivitasResult.data.current.shift),
          getStafOperasionalOptionsAction(),
        ]);
        if (cancelled) return;
        if (!eventsResult.success) {
          setTabError(eventsResult.error);
          setLoadingTab(null);
          return;
        }
        if (!stafResult.success) {
          setTabError(stafResult.error);
          setLoadingTab(null);
          return;
        }
        setAktivitasProduksi({
          ...aktivitasResult.data,
          mesinList: mesinResult.data,
          mesinEvents: eventsResult.data,
          stafOperasionalOptions: stafResult.data,
          timList: timListResult.data,
          timSaya: timSayaResult.data,
          riwayat: riwayatResult.data,
        });
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // warehouse/mesin/kualitas/bahanBaku/aktivitasProduksi are
    // deliberately in the dependency list, not just activeTab: refreshWarehouse/
    // refreshBahanBaku/refreshAktivitasProduksi reset the relevant
    // state to null WITHOUT changing activeTab (a save action's onAfter callback fires
    // while the user is still on that same tab), and this effect must
    // re-run to refetch in that case, not only when the user switches tabs.
  }, [activeTab, warehouse, mesin, takeAwayPending, warehouseJadwal, kualitas, bahanBaku, aktivitasProduksi]);

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
        {visited.has("warehouse") && warehouse && mesin && takeAwayPending && warehouseJadwal && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "warehouse" && "hidden")}>
            <WarehouseView
              posisi={warehouse}
              jadwal={warehouseJadwal}
              onAfterTambah={refreshWarehouse}
              onAfterMuat={refreshWarehouse}
              onMulaiMuatStarted={(jadwalId, jamMulaiMuat) => {
                setWarehouseJadwal((prev) =>
                  prev ? prev.map((j) => (j.JadwalID === jadwalId ? { ...j, JamMulaiMuat: jamMulaiMuat } : j)) : prev
                );
              }}
            />
            <TakeAwayMuatanList
              initialPending={takeAwayPending}
              fetchSelesaiList={getTakeAwayMuatanSelesaiAction}
              onAfterMuat={refreshTakeAway}
            />
          </div>
        )}
        {visited.has("kualitas") && kualitas && mesin && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "kualitas" && "hidden")}>
            <KualitasView initialRiwayat={kualitas} mesinList={mesin} />
          </div>
        )}
        {visited.has("bahan-baku") && bahanBaku && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "bahan-baku" && "hidden")}>
            <BahanBakuView
              current={bahanBaku.current}
              rows={bahanBaku.rows}
              history={bahanBaku.history}
              onAfterSimpan={refreshBahanBaku}
            />
          </div>
        )}
        {visited.has("aktivitas-produksi") && aktivitasProduksi && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "aktivitas-produksi" && "hidden")}>
            <AktivitasProduksiView
              current={aktivitasProduksi.current}
              qty={aktivitasProduksi.qty}
              susunanTim={aktivitasProduksi.susunanTim}
              stafOperasionalNama={aktivitasProduksi.stafOperasionalNama}
              kepalaNama={aktivitasProduksi.kepalaNama}
              wakilKepalaNama={aktivitasProduksi.wakilKepalaNama}
              mesinList={aktivitasProduksi.mesinList}
              mesinEvents={aktivitasProduksi.mesinEvents}
              stafOperasionalOptions={aktivitasProduksi.stafOperasionalOptions}
              timList={aktivitasProduksi.timList}
              timSaya={aktivitasProduksi.timSaya}
              riwayat={aktivitasProduksi.riwayat}
              onChanged={refreshAktivitasProduksi}
            />
          </div>
        )}
      </div>
      <ProduksiBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
