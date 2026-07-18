import { getSalesTrend } from "@/lib/queries/sales";
import { getSalesOverview } from "@/lib/queries/sales-overview";
import { getSalesOrderCards } from "@/lib/queries/sales-cards";
import { getRevenueTarget } from "@/lib/queries/revenue-target";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { SalesOverviewPanels } from "@/components/dashboard/sales-overview-panels";
import { RevenueTargetPanel } from "@/components/dashboard/revenue-target-panel";
import { SalesTrendChart } from "@/components/charts/sales-trend-chart";
import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const filter = resolveFilter(params);
  const [trend, overview, orders, wilayahList, revenueTarget] = await Promise.all([
    getSalesTrend(filter),
    getSalesOverview(),
    getSalesOrderCards(filter),
    getWilayahList(),
    getRevenueTarget(),
  ]);
  const businessTodayISO = getBusinessDateISO();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Penjualan</h1>
      <FilterBar wilayahList={wilayahList} />

      <SalesOverviewPanels overview={overview} businessTodayISO={businessTodayISO} />

      <RevenueTargetPanel target={revenueTarget} />

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Harian</CardTitle>
          <CardDescription>
            Nominal penjualan (batang) serta jumlah dokumen SO/DO/SI (garis) — arahkan kursor ke titik
            untuk detail qty per dokumen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SalesTrendChart data={trend} />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">Kartu Transaksi</h2>
        <SalesTransactionCards orders={orders} />
      </div>
    </div>
  );
}
