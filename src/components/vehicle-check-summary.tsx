"use client";

import { Gauge, Fuel, Clock, Package } from "lucide-react";
import { formatTime } from "@/lib/format";
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

export function CheckSummary({ check }: { check: VehicleCheckRow }) {
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
          {check.muatanQty.toLocaleString("id-ID")} koli
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {check.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
          <img key={p.jenisFoto} src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="h-14 w-full rounded object-cover" />
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
