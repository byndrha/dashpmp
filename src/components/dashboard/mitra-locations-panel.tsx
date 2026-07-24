"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleCard } from "@/components/dashboard/collapsible-card";
import type { MitraLocationPoint } from "@/components/dashboard/mitra-locations-map";

// Same ssr:false dynamic-import pattern as mitra-location-field.tsx uses for
// mitra-location-map.tsx — Leaflet touches browser globals at import time.
const MitraLocationsMap = dynamic(
  () => import("@/components/dashboard/mitra-locations-map").then((m) => m.MitraLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-80 w-full rounded-lg" /> }
);

export function MitraLocationsPanel({ points }: { points: MitraLocationPoint[] }) {
  return (
    <CollapsibleCard title="Peta Lokasi Mitra" description={`${points.length} mitra dengan lokasi tersimpan.`}>
      {points.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra dengan lokasi tersimpan.</p>
      ) : (
        <MitraLocationsMap points={points} />
      )}
    </CollapsibleCard>
  );
}
