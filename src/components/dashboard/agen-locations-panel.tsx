"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MitraEsBalokGrowthTable } from "@/components/dashboard/mitra-es-balok-growth-table";
import { cn } from "@/lib/utils";
import type { AgenLocationPoint } from "@/components/dashboard/agen-locations-map";
import type { MitraGrowthRow } from "@/lib/queries/mitra-es-balok-growth";

const AgenLocationsMap = dynamic(
  () => import("@/components/dashboard/agen-locations-map").then((m) => m.AgenLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full rounded-lg" /> }
);

// Es Balok's analog of mitra-locations-panel.tsx -- map flush at the top
// with a "N mitra dengan lokasi tersimpan" badge overlaid, "Perkembangan
// Mitra per Wilayah" collapsed below it by default.
export function AgenLocationsPanel({
  points,
  growthRows,
  centerFallback,
}: {
  points: AgenLocationPoint[];
  growthRows: MitraGrowthRow[];
  // The company's own Pabrik location, used to center the map when no
  // Mitra pins exist yet -- see AgenLocationsMap's own centerFallback doc.
  centerFallback?: [number, number];
}) {
  const [growthOpen, setGrowthOpen] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-md">
      <div className="relative">
        <AgenLocationsMap points={points} growthRows={growthRows} centerFallback={centerFallback} />
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium text-foreground shadow backdrop-blur">
            {points.length} Mitra dengan lokasi tersimpan
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
              Total Mitra per wilayah & segmentasi, dengan Mitra baru bulan ini (vs bulan lalu).
            </p>
          </div>
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
              !growthOpen && "-rotate-90"
            )}
          />
        </button>
        {growthOpen && <MitraEsBalokGrowthTable rows={growthRows} />}
      </div>
    </div>
  );
}
