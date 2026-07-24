"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatRupiah, formatDays, formatPercentPoints, formatQty, formatDate } from "@/lib/format";
import type { TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_BADGE_VARIANT: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

const TOP_N = 10;

// `rows` already contains the top 10 for EVERY Wilayah (see
// getTopMitraPiutang()) — filtering here is just a slice, so switching the
// Wilayah filter always yields a full 10 rows (top 10 *within* that
// Wilayah) instead of shrinking down a pre-filtered global top 10.
export function TopMitraPiutangPanel({ rows }: { rows: TopMitraPiutangRow[] }) {
  const [wilayahFilter, setWilayahFilter] = useState("all");

  const wilayahOptions = useMemo(() => [...new Set(rows.map((r) => r.Wilayah))].sort(), [rows]);

  const visibleRows = useMemo(() => {
    const scoped = wilayahFilter === "all" ? rows : rows.filter((r) => r.Wilayah === wilayahFilter);
    return [...scoped].sort((a, b) => b.NominalPiutang - a.NominalPiutang).slice(0, TOP_N);
  }, [rows, wilayahFilter]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display">Top 10 Keseluruhan Mitra</CardTitle>
            <CardDescription>
              10 mitra dengan piutang outstanding terbesar, beserta pola pembayaran &amp; pengambilannya.
            </CardDescription>
          </div>
          <Select value={wilayahFilter} onValueChange={(v) => setWilayahFilter(v ?? "all")}>
            <SelectTrigger className="w-44" aria-label="Wilayah">
              <SelectValue>{(v: string) => (v === "all" ? "Semua Wilayah" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Wilayah</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra dengan piutang berjalan.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitra</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Nominal Piutang</TableHead>
                <TableHead className="text-right">Outstanding Day</TableHead>
                <TableHead className="text-right">Rasio Piutang</TableHead>
                <TableHead className="text-right">AVG DO/Hari</TableHead>
                <TableHead className="text-right">DO Terakhir</TableHead>
                <TableHead className="text-right">Terakhir Bayar (SP)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => (
                <TableRow key={r.BusinessPartnerID}>
                  <TableCell className="font-medium">
                    {r.CustomerName}
                    <span className="block text-[11px] font-normal text-muted-foreground">{r.Wilayah}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn("text-[10px]", STATUS_BADGE_VARIANT[r.Status])}>
                      {r.Status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-primary">{formatRupiah(r.NominalPiutang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDays(r.OutstandingDay)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.RasioPiutangPct != null ? formatPercentPoints(r.RasioPiutangPct) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.AvgDOPerHari)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.DOTerakhir ? formatDate(r.DOTerakhir) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.TerakhirPembayaran ? formatDate(r.TerakhirPembayaran) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
