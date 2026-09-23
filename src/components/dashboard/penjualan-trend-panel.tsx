// src/components/dashboard/penjualan-trend-panel.tsx
import { ShoppingCart, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatRupiah } from "@/lib/format";
import type { PenjualanTrendData } from "@/lib/queries/penjualan-piutang";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

export function PenjualanTrendPanel({ data }: { data: PenjualanTrendData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard
          label="Total Kantong (12 Bulan Terakhir)"
          value={formatQty(data.totalKantong12Bulan)}
          icon={ShoppingCart}
        />
        <KpiCard
          label="Total Pendapatan (12 Bulan Terakhir)"
          value={formatRupiah(data.totalPendapatan12Bulan)}
          icon={Wallet}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tren Penjualan Bulanan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead className="text-right">Kantong Kecil</TableHead>
                  <TableHead className="text-right">Kantong Besar</TableHead>
                  <TableHead className="text-right">Total Kantong</TableHead>
                  <TableHead className="text-right">Pendapatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(m.kantongKecil)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(m.kantongBesar)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatQty(m.kantongTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.pendapatanRp)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
