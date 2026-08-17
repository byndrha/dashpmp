"use client";

import { useState } from "react";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { RiwayatPosisiList } from "@/components/produksi-app/tambah-produksi-dialog";
import { KAPASITAS_PALLET_10KG } from "@/lib/queries/produksi-warehouse";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function PetaWarehouseDesktop({ posisi }: { posisi: PalletPosisiRow[] }) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-4 overflow-x-auto pb-2">
        {WAREHOUSE_ZONES.map((zone, zoneIdx) => (
          <div key={zone.id} className="flex items-start gap-4">
            {zoneIdx > 0 && <div className="mt-6 h-full w-px self-stretch bg-border" />}
            <div className="flex min-w-fit flex-col gap-1">
              <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                {zone.label} (kode {zone.id})
              </p>
              {zone.grup.map((g) => (
                <div key={g.id} className="flex flex-col gap-1">
                  {g.rows.map((row, i) => (
                    <div key={i} className="flex gap-2">
                      {row.map((kode) => (
                        <WarehouseCell
                          key={kode}
                          kode={kode}
                          row={byKode.get(kode)}
                          onClick={(r) => r && setSelected(r)}
                        />
                      ))}
                    </div>
                  ))}
                  {g.dividerAfter && (
                    <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
                      <span className="flex-1 border-t border-dashed border-border" />
                      <span>{g.dividerAfter}</span>
                      <span className="flex-1 border-t border-dashed border-border" />
                    </div>
                  )}
                </div>
              ))}
              {zone.showPintuGeser && (
                <p className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-red-600" /> Paling lama
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-amber-500" /> Menengah
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-600" /> Baru
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong
        </span>
      </div>

      {selected && (
        <div className="mt-4 flex flex-col gap-3">
          <RiwayatPosisiList posisiId={selected.PosisiID} open={selected != null} />
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-semibold">Pallet {selected.Kode}</p>
            <p className="text-muted-foreground">
              Terisi {selected.TotalSisaQty10KG}/{KAPASITAS_PALLET_10KG} kantong 10kg
              {selected.JumlahBatchAktif > 1 && ` — ${selected.JumlahBatchAktif} batch aktif`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
