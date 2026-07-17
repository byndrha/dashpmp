import { Zap, Percent, Hash } from "lucide-react";
import { getElectricityCosts } from "@/lib/queries/electricity";
import { getDailySales } from "@/lib/queries/sales";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPercent, formatRupiah } from "@/lib/format";

export default async function ElectricityPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const filter = resolveFilter(params);
  const [entries, sales] = await Promise.all([getElectricityCosts(filter), getDailySales(filter)]);

  const totalCost = entries.reduce((sum, e) => sum + e.Debit - e.Credit, 0);
  const totalRevenue = sales.reduce((sum, s) => sum + s.NetSales, 0);
  const pctOfRevenue = totalRevenue !== 0 ? totalCost / totalRevenue : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Biaya Listrik</h1>
      <FilterBar />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Biaya Listrik" value={formatRupiah(totalCost)} icon={Zap} tone="warning" />
        <KpiCard label="% dari Pendapatan" value={formatPercent(pctOfRevenue)} icon={Percent} tone={pctOfRevenue > 0.25 ? "negative" : "default"} />
        <KpiCard label="Jumlah Transaksi" value={entries.length.toLocaleString("id-ID")} icon={Hash} />
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>No. Voucher</TableHead>
              <TableHead>Memo</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e, i) => (
              <TableRow key={`${e.VoucherNo}-${i}`}>
                <TableCell>{formatDate(e.TransDate)}</TableCell>
                <TableCell>{e.VoucherNo}</TableCell>
                <TableCell className="text-muted-foreground">{e.Memo ?? "-"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(e.Debit - e.Credit)}</TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
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
