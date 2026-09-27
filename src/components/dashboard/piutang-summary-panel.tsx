// src/components/dashboard/piutang-summary-panel.tsx
"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Flame,
  HandCoins,
  Landmark,
  Percent,
  PiggyBank,
  Receipt,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PiutangStatusPanel } from "@/components/dashboard/piutang-status-panel";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";
import type { EsBalokPeriodSummary, EsBalokStatusBucket } from "@/lib/queries/piutang-invoice-outstanding";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const COLLAPSED_MONTH_COUNT = 3;

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-");
  return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
}

// Same helpers as piutang-per-agen-table.tsx's own todayISO/monthStartISO --
// copied locally rather than imported, per the task brief (this file
// doesn't import from that one).
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Mirrors AgingPage's own KpiRowSkeleton (3 boxes, same shape as a KpiCard)
// so the 2 new KPI rows don't jump in height once data arrives.
function KpiRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[104px] w-full rounded-lg" />
      ))}
    </div>
  );
}

export function PiutangSummaryPanel({
  data,
  fetchPeriodSummary,
  fetchStatusOverview,
}: {
  data: PiutangSummaryData;
  fetchPeriodSummary?: (startDate: string, endDate: string) => Promise<EsBalokPeriodSummary>;
  fetchStatusOverview?: () => Promise<EsBalokStatusBucket[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  // `data.months` comes in oldest-first (see monthsWindow() in
  // penjualan-piutang.ts); reversed here so the most recent month reads
  // top-to-bottom, matching how the user scans "what happened lately" first.
  const monthsDesc = [...data.months].reverse();
  const visibleMonths = expanded ? monthsDesc : monthsDesc.slice(0, COLLAPSED_MONTH_COUNT);

  const showEsBalokRows = fetchPeriodSummary != null && fetchStatusOverview != null;

  const [startDate, setStartDate] = useState(monthStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [periodSummary, setPeriodSummary] = useState<EsBalokPeriodSummary | null>(null);
  const [statusOverview, setStatusOverview] = useState<EsBalokStatusBucket[] | null>(null);
  const [loading, setLoading] = useState(showEsBalokRows);
  const [error, setError] = useState<string | null>(null);

  // Mirrors PiutangPerAgenTable's own applyRange (piutang-per-agen-table.tsx)
  // error/catch pattern for consistency: on failure, stop the skeleton,
  // surface a short inline message, and leave the "Terapkan" button as the
  // retry affordance (clicking it clears the error and re-fetches).
  function loadEsBalokRows(start: string, end: string) {
    if (!fetchPeriodSummary || !fetchStatusOverview) return;
    setLoading(true);
    setError(null);
    Promise.all([fetchPeriodSummary(start, end), fetchStatusOverview()])
      .then(([period, status]) => {
        setPeriodSummary(period);
        setStatusOverview(status);
      })
      .catch(() => {
        setError("Gagal memuat data periode ini.");
      })
      .finally(() => setLoading(false));
  }

  // Fetch on mount when the 2 optional props are supplied; when they're
  // omitted this effect is a no-op (showEsBalokRows stays false) so
  // existing callers see no behavior change at all. startDate/endDate are
  // intentionally left out of the deps array: re-running this on every
  // keystroke in the date inputs would be wrong -- only the "Terapkan"
  // button (which reads the current startDate/endDate state directly) is
  // meant to trigger a refetch with the user's chosen range.
  useEffect(() => {
    if (showEsBalokRows) loadEsBalokRows(startDate, endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct =
    periodSummary && periodSummary.totalPenjualanPeriode !== 0
      ? (data.totalPiutangSaatIni / periodSummary.totalPenjualanPeriode) * 100
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {showEsBalokRows && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="piutang-summary-start" className="text-xs">
                Tanggal Awal
              </Label>
              <Input
                id="piutang-summary-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="piutang-summary-end" className="text-xs">
                Tanggal Akhir
              </Label>
              <Input
                id="piutang-summary-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={() => loadEsBalokRows(startDate, endDate)} disabled={loading}>
              {loading ? "Memuat..." : "Terapkan"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}

          {error ? null : loading || !periodSummary || !statusOverview ? (
            <>
              <KpiRowSkeleton />
              <KpiRowSkeleton />
              <Skeleton className="h-24 w-full rounded-lg" />
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <KpiCard label="Saldo Awal Periode" value={formatRupiah(periodSummary.saldoAwalPeriode)} icon={Wallet} />
                <KpiCard
                  label="Pembayaran Piutang Periode Ini"
                  value={formatRupiah(periodSummary.totalPembayaranPeriode)}
                  icon={HandCoins}
                  tone="positive"
                />
                <KpiCard
                  label="Rasio Piutang / Omzet"
                  value={`${pct.toFixed(1)}%`}
                  icon={Percent}
                  tone={pct > 30 ? "negative" : "default"}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <KpiCard label="Total Piutang Outstanding" value={formatRupiah(data.totalPiutangSaatIni)} icon={Receipt} />
                <KpiCard
                  label="Sudah Jatuh Tempo"
                  value={formatRupiah(periodSummary.sudahJatuhTempo)}
                  icon={AlertTriangle}
                  tone="warning"
                />
                <KpiCard
                  label=">90 Hari (Kritis)"
                  value={formatRupiah(periodSummary.kritisNominal)}
                  icon={Flame}
                  tone="negative"
                />
              </div>
              <PiutangStatusPanel
                buckets={statusOverview.map((b) => ({ status: b.status, count: b.mitraCount, total: b.outstanding }))}
              />
            </>
          )}
        </>
      )}
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
