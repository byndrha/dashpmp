import type { Metadata } from "next";
import { requireModuleAccess } from "@/lib/require-access";
import { getSalesTrend, getSalesTrendMonthly } from "@/lib/queries/sales";
import { getSalesOverview } from "@/lib/queries/sales-overview";
import { getRevenueTarget } from "@/lib/queries/revenue-target";
import { getWilayahList } from "@/lib/queries/wilayah";
import { getBusinessDateISO } from "@/lib/business-date";
import { resolveFilter, shiftFilterYears, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { SalesOverviewPanels } from "@/components/dashboard/sales-overview-panels";
import { RevenueTargetPanel } from "@/components/dashboard/revenue-target-panel";
import { SalesTrendChart } from "@/components/charts/sales-trend-chart";
import { SalesTrendChartMonthly } from "@/components/charts/sales-trend-chart-monthly";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata: Metadata = { title: "Penjualan" };

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const filter = resolveFilter(params);
  const filterLastYear = shiftFilterYears(filter, 1);
  const [trend, trendLastYear, trendMonthly, trendMonthlyLastYear, overview, wilayahList, revenueTarget] =
    await Promise.all([
      getSalesTrend(filter),
      getSalesTrend(filterLastYear),
      getSalesTrendMonthly(),
      getSalesTrendMonthly(1),
      getSalesOverview(),
      getWilayahList(),
      getRevenueTarget(),
    ]);
  const businessTodayISO = getBusinessDateISO();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Penjualan</h1>
        <FilterBar wilayahList={wilayahList} />
      </div>

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

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Harian &mdash; Tahun Lalu</CardTitle>
          <CardDescription>Periode yang sama dengan filter di atas, digeser satu tahun ke belakang.</CardDescription>
        </CardHeader>
        <CardContent>
          <SalesTrendChart data={trendLastYear} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Bulanan</CardTitle>
          <CardDescription>
            12 bulan terakhir — bulan berjalan hingga bulan yang sama tahun lalu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SalesTrendChartMonthly data={trendMonthly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Bulanan &mdash; Tahun Lalu</CardTitle>
          <CardDescription>12 bulan yang sama, digeser satu tahun ke belakang.</CardDescription>
        </CardHeader>
        <CardContent>
          <SalesTrendChartMonthly data={trendMonthlyLastYear} />
        </CardContent>
      </Card>
    </div>
  );
}
