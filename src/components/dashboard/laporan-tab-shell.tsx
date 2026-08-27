"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LaporanStokBahanBaku } from "@/components/dashboard/laporan-stok-bahan-baku";
import { LaporanAktivitasProduksi } from "@/components/dashboard/laporan-aktivitas-produksi";
import type { StokBahanBakuRow, CurrentShiftInfo, SaldoAwalRow } from "@/lib/queries/stok-bahan-baku";
import type { AktivitasShiftInfo } from "@/lib/queries/aktivitas-produksi";

type LaporanTab = "stok-bahan-baku" | "aktivitas-produksi";

export function LaporanTabShell({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
  aktivitasRiwayat,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
  aktivitasRiwayat: AktivitasShiftInfo[];
}) {
  const [tab, setTab] = useState<LaporanTab>("stok-bahan-baku");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "stok-bahan-baku" ? "default" : "outline"} onClick={() => setTab("stok-bahan-baku")}>
          Stok Bahan Baku
        </Button>
        <Button size="sm" variant={tab === "aktivitas-produksi" ? "default" : "outline"} onClick={() => setTab("aktivitas-produksi")}>
          Aktivitas Produksi
        </Button>
      </div>
      <div className={cn(tab !== "stok-bahan-baku" && "hidden")}>
        <LaporanStokBahanBaku
          canEdit={canEdit}
          canEditSaldoAwal={canEditSaldoAwal}
          current={current}
          initialCurrentRows={initialCurrentRows}
          initialHistory={initialHistory}
          initialSaldoAwal={initialSaldoAwal}
          namaMap={namaMap}
        />
      </div>
      <div className={cn(tab !== "aktivitas-produksi" && "hidden")}>
        <LaporanAktivitasProduksi riwayat={aktivitasRiwayat} namaMap={namaMap} />
      </div>
    </div>
  );
}
