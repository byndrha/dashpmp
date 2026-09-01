"use client";

import { cn } from "@/lib/utils";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

// Age is measured from TanggalLabel + JamPanen (when the ice actually
// entered cold storage), not TanggalProduksi (when the form was submitted
// — could be minutes or hours after the real harvest moment). Falls back to
// 00:00 if JamPanen is somehow null on an old row, so age is never NaN.
export function ageClass(tanggalLabel: Date | string | null, jamPanen: string | null): string {
  if (!tanggalLabel) return "bg-muted text-muted-foreground";
  const dateOnly = new Date(tanggalLabel).toISOString().slice(0, 10);
  const harvestedAt = new Date(`${dateOnly}T${jamPanen || "00:00"}:00`);
  const ageDays = (Date.now() - harvestedAt.getTime()) / 86400000;
  if (ageDays >= 3) return "bg-red-600 text-white";
  if (ageDays >= 1) return "bg-amber-500 text-white";
  return "bg-emerald-600 text-white";
}

export function WarehouseCell({
  kode,
  row,
  onClick,
  disabled = false,
  highlighted = false,
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
  // Mode ambil stok: kotak kosong dinonaktifkan sepenuhnya (mode ini murni
  // untuk mengambil, bukan menambah stok) -- lihat pallet-ambil-panel.tsx.
  disabled?: boolean;
  // Mode ambil stok: menandai pallet FIFO-terdepan hasil
  // getBatchAktifForAlokasiAction ("ambil di sini dulu").
  highlighted?: boolean;
}) {
  const terisi = (row?.JumlahBatchAktif ?? 0) > 0;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick?.(row)}
      className={cn(
        "relative flex size-[55px] shrink-0 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        terisi ? ageClass(row!.TanggalLabelTertua, row!.JamPanenTertua) : "bg-muted text-muted-foreground",
        disabled && "opacity-40",
        highlighted && "ring-2 ring-offset-1 ring-sky-500"
      )}
    >
      <span>{kode}</span>
      {terisi && <span className="text-[9px] font-normal opacity-90">{row!.TotalSisaQty10KG}</span>}
      {(row?.JumlahBatchAktif ?? 0) > 1 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-foreground px-1 text-[8px] font-bold text-background">
          ×{row!.JumlahBatchAktif}
        </span>
      )}
    </button>
  );
}
