"use client";

import { Gauge, Fuel, Clock, Package, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ImageLightboxTrigger } from "@/components/ui/image-lightbox";
import {
  JENIS_FOTO_LABEL,
  FUEL_BAR_MAX,
  type VehicleCheckRow,
  type VehicleCheckTipe,
} from "@/lib/vehicle-check-types";

// Read-only rendering of one completed vehicle check (odometer, fuel bar,
// muatan qty, photos) — shared by desktop's VehicleCheckDialog (its own
// read-only history view) and satpam-app's Riwayat timeline detail. Split
// into its own file (rather than living inside vehicle-check-dialog.tsx)
// so satpam-app's client bundle doesn't pull in that file's heavier
// camera/carousel imports just for this summary block.
export const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Cek Berangkat", DATANG: "Cek Datang" };

// Chip netral untuk waktu inspeksi, KM, dan BBM di varian ringkas.
const CHIP_RINGKAS =
  "inline-flex shrink-0 items-center gap-1 rounded border border-foreground/15 bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground tabular-nums";

// Ikon pengganti label "Cek Berangkat"/"Cek Datang" di varian ringkas.
export const TIPE_IKON: Record<VehicleCheckTipe, typeof ArrowUpRight> = { BERANGKAT: ArrowUpRight, DATANG: ArrowDownLeft };

export function CheckSummary({
  check,
  packageLabel,
  packageQty,
  ringkas = false,
}: {
  check: VehicleCheckRow;
  // Overrides the "kantong es kristal" line below — used by
  // route-validation-dialog.tsx's "Cek Datang" card to show total Retur
  // instead of MuatanQty (added 2026-09-23), since on return what matters
  // is how much came back, not how much was loaded. Other callers
  // (satpam-app, etc.) leave these unset and get the original behavior.
  packageLabel?: string;
  packageQty?: number;
  // Varian satu-baris untuk kotak Bukti yang melayang di peta Validasi Rute:
  // ikon tipe + jam, KM, BBM, chip qty, lalu thumbnail kecil berjajar.
  ringkas?: boolean;
}) {
  if (ringkas) {
    const Ikon = TIPE_IKON[check.tipe];
    return (
      <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-muted/30 p-2 text-xs">
        <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <span
            title={TIPE_LABEL[check.tipe]}
            aria-label={TIPE_LABEL[check.tipe]}
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Ikon className="size-3.5" />
          </span>
          <span title="Waktu inspeksi" className={cn(CHIP_RINGKAS, "font-semibold text-foreground")}>
            {formatTime(check.checkedAt)}
          </span>
          <span title="Odometer" className={CHIP_RINGKAS}>
            <Gauge className="size-3" />
            {check.odometerKM.toLocaleString("id-ID")} KM
          </span>
          <span title="Bahan bakar" className={CHIP_RINGKAS}>
            <Fuel className="size-3" />
            {check.fuelBar}/{FUEL_BAR_MAX}
          </span>
          {/* Angka saja untuk muatan; label lengkap di tooltip. Retur (Cek
              Datang) tetap diberi kata "retur" supaya tidak tertukar. */}
          <span
            title={`${(packageQty ?? check.muatanQty).toLocaleString("id-ID")} ${packageLabel ?? "kantong es kristal"}`}
            className="truncate rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary tabular-nums"
          >
            {(packageQty ?? check.muatanQty).toLocaleString("id-ID")}
            {packageLabel ? ` ${packageLabel.replace(/^kantong\s+/i, "")}` : ""}
          </span>
        </div>
        {check.photos.length > 0 && (
          <div className="flex gap-1 overflow-hidden">
            {check.photos.map((p) => (
              <ImageLightboxTrigger
                key={p.jenisFoto}
                src={p.filePath}
                alt={JENIS_FOTO_LABEL[p.jenisFoto]}
                className="size-9 shrink-0 overflow-hidden rounded"
              />
            ))}
          </div>
        )}
        {check.remark && (
          <p className="truncate text-[11px] text-foreground" title={check.remark}>
            <span className="font-medium text-warning">Remark: </span>
            {check.remark}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{TIPE_LABEL[check.tipe]}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(check.checkedAt)}
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <Gauge className="size-3" />
          {check.odometerKM.toLocaleString("id-ID")} KM
        </span>
        <span className="flex items-center gap-1">
          <Fuel className="size-3" />
          {check.fuelBar} / {FUEL_BAR_MAX} bar
        </span>
        <span className="flex items-center gap-1">
          <Package className="size-3" />
          {(packageQty ?? check.muatanQty).toLocaleString("id-ID")} {packageLabel ?? "kantong es kristal"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {check.photos.map((p) => (
          <ImageLightboxTrigger
            key={p.jenisFoto}
            src={p.filePath}
            alt={JENIS_FOTO_LABEL[p.jenisFoto]}
            className="h-14 w-full overflow-hidden rounded"
          />
        ))}
      </div>
      {check.remark && (
        <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-foreground">
          <span className="font-medium text-warning">Remark: </span>
          {check.remark}
        </p>
      )}
    </div>
  );
}
