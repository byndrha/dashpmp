// src/components/dashboard/piutang-summary-panel.tsx
import { Landmark, Warehouse, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatRupiah } from "@/lib/format";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

export function PiutangSummaryPanel({ data }: { data: PiutangSummaryData }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Piutang Saat Ini" value={formatRupiah(data.totalPiutangSaatIni)} icon={Landmark} />
        <KpiCard label="Piutang — Utama" value={formatRupiah(data.totalPiutangUtama)} icon={Warehouse} />
        <KpiCard label="Piutang — Logistik" value={formatRupiah(data.totalPiutangLogistik)} icon={Truck} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tren Pergerakan Piutang Bulanan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead className="text-right">Piutang Baru</TableHead>
                  <TableHead className="text-right">Tertagih</TableHead>
                  <TableHead className="text-right">Pergerakan Bersih</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangBaru)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangTertagih)}</TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${
                        m.netMovement >= 0 ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {formatRupiah(m.netMovement)}
                    </TableCell>
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
