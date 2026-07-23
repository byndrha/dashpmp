import { requireModuleAccess } from "@/lib/require-access";
import { getOpenDeliveries, getDriverOptions } from "@/lib/queries/delivery";
import { getPengirimanBoard } from "@/lib/queries/pengiriman-jadwal";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { OpenDeliveriesPanel } from "@/components/dashboard/open-deliveries-panel";
import { PengirimanBoard } from "@/components/dashboard/pengiriman-board";
import { PengirimanTabs } from "@/components/dashboard/pengiriman-tabs";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ wilayah?: string; pengirimanDate?: string }>;
}) {
  await requireModuleAccess("delivery");
  const params = await searchParams;
  // Wilayah only filters the "Pengiriman Terbuka" tab (getOpenDeliveries) —
  // the board is date-scoped instead and intentionally shows every wilayah
  // for that date.
  const wilayah = params.wilayah || undefined;

  const todayISO = getBusinessDateISO();
  const boardDate = params.pengirimanDate && params.pengirimanDate <= todayISO ? params.pengirimanDate : todayISO;

  const [rows, wilayahList, board, drivers] = await Promise.all([
    getOpenDeliveries(wilayah),
    getWilayahList(),
    getPengirimanBoard(boardDate),
    getDriverOptions(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <FilterBar wilayahList={wilayahList} showDateRange={false} />
      </div>

      <PengirimanTabs
        terbukaPanel={<OpenDeliveriesPanel rows={rows} />}
        papanPanel={
          <PengirimanBoard
            armada={board.armada}
            jadwal={board.jadwal}
            drivers={drivers}
            businessDate={boardDate}
            todayISO={todayISO}
          />
        }
      />
    </div>
  );
}
