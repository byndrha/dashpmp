import { requireModuleAccess } from "@/lib/require-access";
import { getSalesOrderCards } from "@/lib/queries/sales-cards";
import { getMitraDOMonthly } from "@/lib/queries/mitra-do";
import { getWilayahDeliverySummary } from "@/lib/queries/delivery";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { TransaksiPanels } from "@/components/dashboard/transaksi-panels";

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams & { marketing?: string }>;
}) {
  await requireModuleAccess("transaksi");
  const params = await searchParams;
  const filter = resolveFilter(params);
  const [orders, wilayahList, mitraDO, wilayahDelivery] = await Promise.all([
    getSalesOrderCards(filter),
    getWilayahList(),
    getMitraDOMonthly(filter),
    getWilayahDeliverySummary(filter),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Transaksi</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

      <TransaksiPanels
        orders={orders}
        wilayahDelivery={wilayahDelivery}
        mitraDO={mitraDO}
        initialMarketingFilter={params.marketing}
      />
    </div>
  );
}
