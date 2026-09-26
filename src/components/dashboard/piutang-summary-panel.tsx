// src/components/dashboard/piutang-summary-panel.tsx
"use client";

import { useState } from "react";
import { ChevronDown, Landmark, PiggyBank } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const COLLAPSED_MONTH_COUNT = 3;

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

export function PiutangSummaryPanel({ data }: { data: PiutangSummaryData }) {
  const [expanded, setExpanded] = useState(false);
  // `data.months` comes in oldest-first (see monthsWindow() in
  // penjualan-piutang.ts); reversed here so the most recent month reads
  // top-to-bottom, matching how the user scans "what happened lately" first.
  const monthsDesc = [...data.months].reverse();
  const visibleMonths = expanded ? monthsDesc : monthsDesc.slice(0, COLLAPSED_MONTH_COUNT);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Total Piutang (Hutang) Saat Ini" value={formatRupiah(data.totalPiutangSaatIni)} icon={Landmark} />
        <KpiCard label="Total Tabungan Saat Ini" value={formatRupiah(data.totalTabunganSaatIni)} icon={PiggyBank} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Tren Pergerakan Piutang Bulanan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bulan</TableHead>
                  <TableHead className="text-right">Piutang</TableHead>
                  <TableHead className="text-right">Pembayaran</TableHead>
                  <TableHead className="text-right">Tarikan</TableHead>
                  <TableHead className="text-right" title="Perubahan bersih saldo Piutang bulan ini: Piutang baru dikurangi Pembayaran, ditambah Tarikan.">
                    Pergerakan Bersih
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMonths.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell>{formatMonthLabel(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangBaru)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangPembayaran)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(m.piutangTarikan)}</TableCell>
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
          {monthsDesc.length > COLLAPSED_MONTH_COUNT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Sembunyikan" : `Tampilkan ${monthsDesc.length - COLLAPSED_MONTH_COUNT} bulan lainnya`}
              <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
