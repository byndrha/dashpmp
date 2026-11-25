import type { Metadata } from "next";
import Link from "next/link";
import { Printer } from "lucide-react";
import { requireModuleAccess } from "@/lib/require-access";
import { getOpenDeliveries, getDriverOptions } from "@/lib/queries/delivery";
import { getPengirimanBoard, getArmadaOperationalStatuses } from "@/lib/queries/pengiriman-jadwal";
import { getKendalaReports } from "@/lib/queries/driver-kendala";
import { getArmadaActivities } from "@/lib/queries/armada-activity";
import { getDriverProfiles } from "@/lib/queries/driver-profile";
import { getExpeditionVehicleOptions } from "@/lib/queries/expedition";
import { getLatestVehiclePositions, ringkasGpsPerArmada } from "@/lib/queries/armada-gps";
import { getBusinessDateISO } from "@/lib/business-date";
import { Button } from "@/components/ui/button";
import { OpenDeliveriesPanel } from "@/components/dashboard/open-deliveries-panel";
import { PengirimanBoard } from "@/components/dashboard/pengiriman-board";
import { PengirimanTabs } from "@/components/dashboard/pengiriman-tabs";
import { KendalaReportPanel } from "@/components/dashboard/kendala-report-panel";
import { PrintQueuePoller } from "@/components/dashboard/print-queue-poller";
// VehicleGpsPanel internally calls L.divIcon() (Leaflet) at render time,
// which crashes with "window is not defined" if statically imported into
// this server component. `dynamic(..., { ssr: false })` (same pattern as
// RouteMap in route-validation-dialog.tsx) can't live here directly though —
// this Next.js version refuses `ssr: false` inside a Server Component
// (node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md: "ssr: false
// option is not supported in Server Components"), so that dynamic() call is
// hosted in this tiny "use client" wrapper instead.
import { VehicleGpsPanelLoader } from "@/components/dashboard/vehicle-gps-panel-loader";

export const metadata: Metadata = { title: "Pengiriman" };

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ pengirimanDate?: string }>;
}) {
  await requireModuleAccess("delivery");
  const params = await searchParams;
  // Filter wilayah kini ada DI DALAM tab "Pengiriman Terbuka" (client-side,
  // OpenDeliveriesPanel) — dulu di header halaman padahal hanya berlaku
  // untuk tab itu; papan memang selalu menampilkan semua wilayah.

  const todayISO = getBusinessDateISO();
  const boardDate =
    params.pengirimanDate && /^\d{4}-\d{2}-\d{2}$/.test(params.pengirimanDate) ? params.pengirimanDate : todayISO;

  const [
    rows,
    board,
    drivers,
    activities,
    driverProfiles,
    expeditionOptions,
    kendalaReports,
    vehiclePositions,
  ] = await Promise.all([
    getOpenDeliveries(),
    getPengirimanBoard(boardDate),
    getDriverOptions(),
    getArmadaActivities(boardDate),
    getDriverProfiles(),
    getExpeditionVehicleOptions(),
    getKendalaReports(),
    getLatestVehiclePositions(),
  ]);

  // Best-effort: the GPS tooltip's status line is a nice-to-have on top of
  // the page's core delivery-management purpose, so a slow/failing MSSQL
  // round-trip here must never take down the whole page — fall back to "no
  // status known" (an empty array) rather than letting the error propagate.
  const armadaIdsWithGps = [...new Set(vehiclePositions.map((v) => v.armadaId).filter((id) => id != null))];
  const armadaStatuses = await getArmadaOperationalStatuses(armadaIdsWithGps, boardDate)
    .then((map) => [...map.entries()].map(([armadaId, status]) => ({ armadaId, status })))
    .catch((err) => {
      console.warn("[delivery/page] Gagal mengambil status operasional armada untuk tooltip GPS:", err);
      return [];
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <div className="flex flex-wrap items-center gap-2">
          <PrintQueuePoller />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" render={<Link href="/mkesindo/delivery/cetak" />}>
            <Printer className="size-3.5" /> Manajemen Cetak
          </Button>
        </div>
      </div>

      <PengirimanTabs
        terbukaPanel={<OpenDeliveriesPanel rows={rows} sekarangMs={new Date(`${todayISO}T00:00:00Z`).getTime()} />}
        kendalaPanel={<KendalaReportPanel rows={kendalaReports} />}
        gpsPanel={<VehicleGpsPanelLoader initialPositions={vehiclePositions} initialArmadaStatuses={armadaStatuses} />}
        papanPanel={
          <PengirimanBoard
            armada={board.armada}
            gpsArmada={ringkasGpsPerArmada(vehiclePositions)}
            jadwal={board.jadwal}
            externalDeliveries={board.externalDeliveries}
            takeawayOrders={board.takeawayOrders}
            activities={activities}
            driverProfiles={driverProfiles}
            drivers={drivers}
            businessDate={boardDate}
            todayISO={todayISO}
            expeditionOptions={expeditionOptions}
          />
        }
      />
    </div>
  );
}
