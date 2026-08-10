"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

const JENDELA_LAYOUT: { jendela: number; atas: [string, string]; bawah: [string, string] }[] = [
  { jendela: 1, atas: ["1C", "1A"], bawah: ["1D", "1B"] },
  { jendela: 2, atas: ["2C", "2A"], bawah: ["2D", "2B"] },
  { jendela: 3, atas: ["3C", "3A"], bawah: ["3D", "3B"] },
];

function ageClass(tanggalProduksi: Date | string | null): string {
  if (!tanggalProduksi) return "bg-muted text-muted-foreground";
  const ageDays = (Date.now() - new Date(tanggalProduksi).getTime()) / 86400000;
  if (ageDays >= 3) return "bg-red-600 text-white";
  if (ageDays >= 1) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function PetaWarehouse({ posisi }: { posisi: PalletPosisiRow[] }) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  function Cell({ kode }: { kode: string }) {
    const row = byKode.get(kode);
    return (
      <button
        type="button"
        onClick={() => row && setSelected(row)}
        className={cn(
          "flex h-14 flex-1 items-center justify-center rounded-md text-xs font-semibold",
          row ? ageClass(row.TanggalProduksi) : "bg-muted text-muted-foreground"
        )}
      >
        {kode}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mx-auto flex max-w-xs flex-col gap-1">
        {JENDELA_LAYOUT.map(({ jendela, atas, bawah }) => (
          <div key={jendela} className="flex flex-col gap-1">
            <div className="flex gap-2">
              <Cell kode={atas[0]} />
              <Cell kode={atas[1]} />
            </div>
            <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
              <span className="flex-1 border-t border-dashed border-border" />
              <span>Jalan &amp; Jendela {jendela}</span>
              <span className="flex-1 border-t border-dashed border-border" />
            </div>
            <div className="flex gap-2">
              <Cell kode={bawah[0]} />
              <Cell kode={bawah[1]} />
            </div>
          </div>
        ))}
        <p className="mt-2 text-center text-[11px] text-muted-foreground">Jalan</p>
        <p className="rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-red-600" /> Paling lama</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-amber-500" /> Menengah</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-emerald-600" /> Baru</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-muted" /> Kosong</span>
      </div>

      {selected && (
        <div className="mt-4 rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}
    </div>
  );
}
