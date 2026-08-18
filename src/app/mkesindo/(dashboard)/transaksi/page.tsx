import { requireModuleAccess } from "@/lib/require-access";
import { getSalesOrderCards } from "@/lib/queries/sales-cards";
import { getMitraDOMonthly } from "@/lib/queries/mitra-do";
import { getMitraContactLogSummaryForRange } from "@/lib/queries/mitra-contact-log";
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
  // +1 day past filter.endDate: the "Besok" tab (Hari ini/Besok switcher in
  // MitraDOPanel) can write to tomorrow's date even when today is the last
  // day of the visible range, and that write needs to show up in this
  // summary without falling just outside the filtered window.
  const contactLogRangeEnd = new Date(filter.endDate);
  contactLogRangeEnd.setUTCDate(contactLogRangeEnd.getUTCDate() + 1);
  const [orders, wilayahList, mitraDO, wilayahDelivery, contactLogSummary] = await Promise.all([
    getSalesOrderCards(filter),
    getWilayahList(),
    getMitraDOMonthly(filter),
    getWilayahDeliverySummary(filter),
    getMitraContactLogSummaryForRange(filter.startDate, contactLogRangeEnd.toISOString().slice(0, 10)),
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
        contactLogSummary={contactLogSummary}
        initialMarketingFilter={params.marketing}
      />
    </div>
  );
}
