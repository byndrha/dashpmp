import { requireModuleAccess } from "@/lib/require-access";
import { getOpenDeliveries, getDeliveryAssignments, getDriverOptions } from "@/lib/queries/delivery";
import { getArmadaList } from "@/lib/queries/armada";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { OpenDeliveriesPanel } from "@/components/dashboard/open-deliveries-panel";
import { DeliveryAssignmentPanel } from "@/components/dashboard/delivery-assignment-panel";
import { PengirimanTabs } from "@/components/dashboard/pengiriman-tabs";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ wilayah?: string; pengirimanDate?: string }>;
}) {
  await requireModuleAccess("delivery");
  const params = await searchParams;
  // Wilayah only filters the "Pengiriman Terbuka" tab (getOpenDeliveries) —
  // the assignment tab is date-scoped instead and intentionally shows every
  // wilayah for that date.
  const wilayah = params.wilayah || undefined;

  const todayISO = getBusinessDateISO();
  const assignmentDate =
    params.pengirimanDate && params.pengirimanDate <= todayISO ? params.pengirimanDate : todayISO;
  const businessAssignmentDate = new Date(assignmentDate);

  const [rows, wilayahList, assignmentRows, drivers, armada] = await Promise.all([
    getOpenDeliveries(wilayah),
    getWilayahList(),
    getDeliveryAssignments(businessAssignmentDate),
    getDriverOptions(),
    getArmadaList(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Pengiriman</h1>
        <FilterBar wilayahList={wilayahList} showDateRange={false} />
      </div>

      <PengirimanTabs
        terbukaPanel={<OpenDeliveriesPanel rows={rows} />}
        penugasanPanel={
          <DeliveryAssignmentPanel
            rows={assignmentRows}
            drivers={drivers}
            armada={armada}
            businessDate={assignmentDate}
            todayISO={todayISO}
          />
        }
      />
    </div>
  );
}
