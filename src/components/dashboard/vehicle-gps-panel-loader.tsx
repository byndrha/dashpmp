"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { VehiclePositionRow } from "@/lib/queries/armada-gps";
import type { ArmadaOperationalStatus } from "@/lib/queries/pengiriman-jadwal";

// VehicleGpsPanel calls L.divIcon() (Leaflet) at render time for its truck
// marker icons, which crashes with "window is not defined" if statically
// imported into the (server-component) delivery page. `ssr: false` on
// next/dynamic is only allowed inside a Client Component (Next 16 breaking
// change — see node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md,
// "Note: ssr: false option is not supported in Server Components"), so this
// thin client wrapper exists purely to host that dynamic() call — same
// end result as RouteMap's dynamic() in route-validation-dialog.tsx, which
// is itself already a "use client" file and didn't need this extra layer.
const VehicleGpsPanel = dynamic(
  () => import("@/components/dashboard/vehicle-gps-panel").then((m) => m.VehicleGpsPanel),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full rounded-lg" /> }
);

export function VehicleGpsPanelLoader({
  initialPositions,
  initialArmadaStatuses,
}: {
  initialPositions: VehiclePositionRow[];
  initialArmadaStatuses: { armadaId: number; status: ArmadaOperationalStatus }[];
}) {
  return <VehicleGpsPanel initialPositions={initialPositions} initialArmadaStatuses={initialArmadaStatuses} />;
}
