import { getDailySales, getSalesTrend } from "@/lib/queries/sales";
import { getSalesOverview } from "@/lib/queries/sales-overview";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { SalesOverviewPanels } from "@/components/dashboard/sales-overview-panels";
import { SalesTrendChart } from "@/components/charts/sales-trend-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatDate, formatRupiah } from "@/lib/format";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const filter = resolveFilter(params);
  const [rows, trend, overview, wilayahList] = await Promise.all([
    getDailySales(filter),
    getSalesTrend(filter),
    getSalesOverview(),
    getWilayahList(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Penjualan</h1>
      <FilterBar wilayahList={wilayahList} />

      <SalesOverviewPanels overview={overview} />

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Tren Penjualan Harian</CardTitle>
          <CardDescription>Nominal penjualan (batang) serta jumlah dokumen SO/DO/SI (garis).</CardDescription>
        </CardHeader>
        <CardContent>
          <SalesTrendChart data={trend} />
        </CardContent>
      </Card>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Wilayah</TableHead>
              <TableHead className="text-right">Jml Invoice</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Diskon</TableHead>
              <TableHead className="text-right">Pajak</TableHead>
              <TableHead className="text-right">Netto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.Wilayah}-${r.SalesDate}`}>
                <TableCell>{formatDate(r.SalesDate)}</TableCell>
                <TableCell>{r.Wilayah}</TableCell>
                <TableCell className="text-right tabular-nums">{r.InvoiceCount}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(r.GrossAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(r.TotalDiscount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(r.TotalTax)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{formatRupiah(r.NetSales)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Tidak ada data pada periode ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
