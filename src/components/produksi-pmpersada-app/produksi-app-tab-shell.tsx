"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProduksiAppBottomNav } from "./bottom-nav";
import { getRekMapProduksiAppAction, getBakListProduksiAppAction, getRiwayatSayaProduksiAppAction } from "@/app/pmpersada/produksi-app/actions";
import type { RekMapRow, BakRow, AuditLogRow } from "@/lib/queries/produksi-bak-pmpersada";
import { DenahProduksiAppView } from "./denah-view";
import { RiwayatProduksiAppView } from "./riwayat-view";
import { ProfilProduksiAppView } from "./profil-view";

export type ProduksiAppTabKey = "denah" | "riwayat" | "profil";

const TAB_PATHS: Record<ProduksiAppTabKey, string> = {
  denah: "/pmpersada/produksi-app",
  riwayat: "/pmpersada/produksi-app/riwayat",
  profil: "/pmpersada/produksi-app/profil",
};

export function ProduksiAppTabShell({
  initialTab,
  userName,
  initialBak,
  initialRek,
  initialRiwayat,
}: {
  initialTab: ProduksiAppTabKey;
  userName: string;
  initialBak?: BakRow[];
  initialRek?: RekMapRow[];
  initialRiwayat?: AuditLogRow[];
}) {
  const [activeTab, setActiveTab] = useState<ProduksiAppTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<ProduksiAppTabKey>>(() => new Set([initialTab]));

  const [bak, setBak] = useState<BakRow[] | null>(initialBak ?? null);
  const [rek, setRek] = useState<RekMapRow[] | null>(initialRek ?? null);
  const [riwayat, setRiwayat] = useState<AuditLogRow[] | null>(initialRiwayat ?? null);

  const [loadingTab, setLoadingTab] = useState<ProduksiAppTabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);

  function handleChangeTab(tab: ProduksiAppTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  function refreshDenah() {
    setBak(null);
    setRek(null);
    // Aksi Denah (Isi Air Baru/Babonan/Maintenance) juga menulis baris audit
    // log milik operator ini -- null-kan riwayat juga supaya tab Riwayat
    // (yang tetap mounted karena shell ini keep-alive) fetch ulang saat
    // berikutnya dibuka, bukan menampilkan snapshot lama sepanjang sesi.
    setRiwayat(null);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setTabError(null);
      if (activeTab === "denah" && (bak === null || rek === null)) {
        setLoadingTab("denah");
        const [bakResult, rekResult] = await Promise.all([getBakListProduksiAppAction(), getRekMapProduksiAppAction()]);
        if (cancelled) return;
        if (!bakResult.success) { setTabError(bakResult.error); setLoadingTab(null); return; }
        if (!rekResult.success) { setTabError(rekResult.error); setLoadingTab(null); return; }
        setBak(bakResult.data);
        setRek(rekResult.data);
        setLoadingTab(null);
        return;
      }
      if (activeTab === "riwayat" && riwayat === null) {
        setLoadingTab("riwayat");
        const result = await getRiwayatSayaProduksiAppAction();
        if (cancelled) return;
        if (!result.success) { setTabError(result.error); setLoadingTab(null); return; }
        setRiwayat(result.data);
        setLoadingTab(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, bak, rek, riwayat]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        {loadingTab && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {tabError && (
          <p className="absolute inset-x-4 top-4 z-10 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{tabError}</p>
        )}
        {visited.has("denah") && bak && rek && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "denah" && "hidden")}>
            <DenahProduksiAppView bak={bak} rek={rek} onAfterAksi={refreshDenah} />
          </div>
        )}
        {visited.has("riwayat") && riwayat && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "riwayat" && "hidden")}>
            <RiwayatProduksiAppView entries={riwayat} />
          </div>
        )}
        {visited.has("profil") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "profil" && "hidden")}>
            <ProfilProduksiAppView userName={userName} />
          </div>
        )}
      </div>
      <ProduksiAppBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
