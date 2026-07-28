"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MitraGrowthTable } from "@/components/dashboard/mitra-growth-panel";
import { cn } from "@/lib/utils";
import type { MitraLocationPoint } from "@/components/dashboard/mitra-locations-map";
import type { MitraGrowthRow } from "@/lib/queries/mitra-growth";

// Same ssr:false dynamic-import pattern as mitra-location-field.tsx uses for
// mitra-location-map.tsx — Leaflet touches browser globals at import time.
const MitraLocationsMap = dynamic(
  () => import("@/components/dashboard/mitra-locations-map").then((m) => m.MitraLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full rounded-lg" /> }
);

// This panel now stands in for the page's own header — no card title/
// description row, the map itself sits flush at the very top (no padding,
// no collapse) with the "N mitra dengan lokasi tersimpan" count overlaid
// as a centered badge instead of card chrome text. Perkembangan Mitra per
// Wilayah stays nested below it with its own independent collapse.
export function MitraLocationsPanel({
  points,
  growthRows,
}: {
  points: MitraLocationPoint[];
  growthRows: MitraGrowthRow[];
}) {
  const [growthOpen, setGrowthOpen] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-md">
      <div className="relative">
        <MitraLocationsMap points={points} growthRows={growthRows} />
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow backdrop-blur">
            {points.length} mitra dengan lokasi tersimpan
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-4">
        <button
          type="button"
          onClick={() => setGrowthOpen((v) => !v)}
          className="flex w-full items-start justify-between gap-2 text-left"
        >
          <div>
            <h3 className="font-display text-sm font-semibold">Perkembangan Mitra per Wilayah</h3>
            <p className="text-xs text-muted-foreground">
              Total mitra per wilayah & tipe, dengan mitra baru bulan ini (vs bulan lalu).
            </p>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
              !growthOpen && "-rotate-90"
            )}
          />
        </button>
        {growthOpen && <MitraGrowthTable rows={growthRows} />}
      </div>
    </div>
  );
}
