import { Wallet, Receipt, Calculator } from "lucide-react";
import { getDailySales } from "@/lib/queries/sales";
import { getWilayahList } from "@/lib/queries/wilayah";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatRupiah } from "@/lib/format";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const filter = resolveFilter(params);
  const [rows, wilayahList] = await Promise.all([getDailySales(filter), getWilayahList()]);

  const totalNet = rows.reduce((sum, r) => sum + r.NetSales, 0);
  const totalInvoices = rows.reduce((sum, r) => sum + r.InvoiceCount, 0);

  const byDate = new Map<string, number>();
  for (const r of rows) {
    byDate.set(r.SalesDate, (byDate.get(r.SalesDate) ?? 0) + r.NetSales);
  }
  const trendData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ name: formatDate(date), value }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Penjualan</h1>
      <FilterBar wilayahList={wilayahList} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Penjualan Bersih" value={formatRupiah(totalNet)} icon={Wallet} tone="positive" />
        <KpiCard label="Jumlah Invoice" value={totalInvoices.toLocaleString("id-ID")} icon={Receipt} />
        <KpiCard
          label="Rata-rata / Invoice"
          value={formatRupiah(totalInvoices ? totalNet / totalInvoices : 0)}
          icon={Calculator}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tren Penjualan Harian</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleBarChart data={trendData} />
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
