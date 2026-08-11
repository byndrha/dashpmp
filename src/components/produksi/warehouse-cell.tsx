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
}: {
  kode: string;
  row: PalletPosisiRow | undefined;
  onClick?: (row: PalletPosisiRow | undefined) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(row)}
      className={cn(
        "flex h-14 flex-1 flex-col items-center justify-center rounded-md text-xs font-semibold leading-tight",
        row?.BatchIDAktif != null ? ageClass(row.TanggalLabel, row.JamPanen) : "bg-muted text-muted-foreground"
      )}
    >
      <span>{kode}</span>
      {row?.BatchIDAktif != null && (
        <span className="text-[9px] font-normal opacity-90">
          {row.SisaQty10KG ?? 0}-{row.SisaQty5KG ?? 0}
        </span>
      )}
    </button>
  );
}
