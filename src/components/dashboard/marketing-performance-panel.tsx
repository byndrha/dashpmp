"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { MarketingPerformanceData, MarketingScopeCell } from "@/lib/queries/marketing-performance";
import type { MarketingKPIRow } from "@/lib/queries/mitra-pengajuan";
import { setMarketingPeriodSettingAction } from "@/app/(dashboard)/pemasaran/actions";

// Absorbed from the old MarketingKPIPanel ("Pencapaian Marketing — Bulan
// Berjalan", now removed) — Jumlah Kunjungan/Konversi Transaksi live inside
// each Marketing's card here instead.
const TARGET_KUNJUNGAN_BULANAN = 300;

const INFO_COL_CLASS = "w-48 sm:w-56";
const DAY_COL_CLASS = "h-20 w-14";

interface AggregatedRow {
  MarketingUserID: string;
  MarketingNama: string;
  TargetHarian: number;
  DailyQty: number[];
  TotalQty: number;
  PctAchievement: number | null;
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// "dd/MM" — matches Beranda's date-label convention (formatDayMonth in
// format.ts), just without the year since every column here is already
// within the same configured period.
function formatDayMonth(dateISO: string): string {
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}`;
}

// Two-line cell: calendar date above, qty + explicit +/- delta against the
// immediately preceding day below — per explicit request ("sebutkan, misal
// +20 atau -4"), not just an arrow like mitra-do-panel.tsx's DayChip.
function DayCell({
  dateISO,
  qty,
  prevQty,
  isPast,
}: {
  dateISO: string;
  qty: number;
  prevQty: number | null;
  isPast: boolean;
}) {
  const delta = isPast && prevQty != null ? qty - prevQty : null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-0.5 border-r text-[10px] tabular-nums",
        DAY_COL_CLASS
      )}
    >
      <span className="text-[9px] text-muted-foreground/60">{formatDayMonth(dateISO)}</span>
      <span className="font-semibold">{isPast ? formatQty(qty) : "-"}</span>
      {delta != null ? (
        <span
          className={cn(
            "flex items-center gap-0.5 text-[9px]",
            delta > 0 && "text-primary",
            delta < 0 && "text-destructive",
            delta === 0 && "text-muted-foreground/50"
          )}
        >
          {delta > 0 && <ArrowUp className="size-2.5 shrink-0" />}
          {delta < 0 && <ArrowDown className="size-2.5 shrink-0" />}
          {delta > 0 ? `+${formatQty(delta)}` : formatQty(delta)}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/30">&mdash;</span>
      )}
    </div>
  );
}

function MarketingCard({
  row,
  kpi,
  dates,
  todayISO,
}: {
  row: AggregatedRow;
  kpi: MarketingKPIRow | undefined;
  dates: string[];
  todayISO: string;
}) {
  const kunjungan = kpi?.Kunjungan ?? 0;
  const konversiPct = kpi && kpi.Kunjungan > 0 ? (kpi.Konversi / kpi.Kunjungan) * 100 : 0;
  return (
    <div className="flex items-stretch">
      <Link
        href={`/transaksi?marketing=${encodeURIComponent(row.MarketingNama)}`}
        className={cn(
          "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1.5 bg-card py-3 pr-3 transition-colors hover:bg-accent/50",
          INFO_COL_CLASS
        )}
        title="Lihat Transaksi DO per Mitra untuk Marketing ini"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate font-medium">{row.MarketingNama}</p>
          <span className="shrink-0 rounded-md border bg-secondary/50 px-2 py-0.5 text-xs font-semibold tabular-nums">
            {formatQty(row.TargetHarian)}/hari
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Pencapaian <span className="font-medium text-foreground">{formatQty(row.TotalQty)}</span>{" "}
          <span className={cn(row.PctAchievement != null && row.PctAchievement >= 100 && "font-medium text-primary")}>
            ({row.PctAchievement != null ? row.PctAchievement.toFixed(0) : "-"}%)
          </span>
        </p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>
            Kunjungan {kunjungan.toLocaleString("id-ID")}/{TARGET_KUNJUNGAN_BULANAN}
          </span>
          <span>Konversi {konversiPct.toFixed(0)}%</span>
        </div>
      </Link>
      <div className="flex border-l">
        {dates.map((dateISO, i) => (
          <DayCell
            key={dateISO}
            dateISO={dateISO}
            qty={row.DailyQty[i]}
            prevQty={i > 0 ? row.DailyQty[i - 1] : null}
            isPast={dateISO <= todayISO}
          />
        ))}
      </div>
    </div>
  );
}

function PeriodSettings({ rangeStartISO, periodDays }: { rangeStartISO: string; periodDays: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(rangeStartISO);
  const [days, setDays] = useState(String(periodDays));
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const parsedDays = Number(days);
    if (!startDate || Number.isNaN(parsedDays) || parsedDays < 1) {
      toast.error("Tanggal mulai dan panjang periode harus diisi dengan benar.");
      return;
    }
    startTransition(async () => {
      try {
        await setMarketingPeriodSettingAction({ startDate, periodDays: parsedDays });
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan pengaturan periode.");
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStartDate(rangeStartISO);
          setDays(String(periodDays));
        }
      }}
    >
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <Settings2 className="size-3.5" />
        Atur Periode
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <p className="mb-2 text-xs font-medium">Ubah Periode Kinerja Marketing</p>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="periodStart" className="text-[11px] text-muted-foreground">
              Tanggal Mulai
            </Label>
            <Input
              id="periodStart"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="periodDays" className="text-[11px] text-muted-foreground">
              Panjang Periode (hari)
            </Label>
            <Input
              id="periodDays"
              type="number"
              min={1}
              max={62}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const ALL = "all";

// Per-Marketing counterpart to Transaksi's "Transaksi DO per Mitra — Bulan
// Berjalan" panel — same day-grid layout, but each row aggregates every
// mitra resolved to that Marketing's Wilayah/Kecamatan scope (not one row
// per mitra), and the date range is the configurable Kinerja Marketing
// period, not the calendar month. Also absorbs the old MarketingKPIPanel's
// Kunjungan/Konversi metrics (via `kpiRows`) — that panel was removed once
// its content moved here. Clicking a Marketing's info box jumps to
// Transaksi pre-filtered to that Marketing.
export function MarketingPerformancePanel({
  data,
  kpiRows,
  canManageSettings,
}: {
  data: MarketingPerformanceData;
  kpiRows: MarketingKPIRow[];
  canManageSettings: boolean;
}) {
  const { cells, periodDays, rangeStartISO, todayISO } = data;
  const [wilayahFilter, setWilayahFilter] = useState(ALL);
  const [kecamatanFilter, setKecamatanFilter] = useState(ALL);

  const kpiByUserId = useMemo(() => new Map(kpiRows.map((r) => [r.UserID, r])), [kpiRows]);

  const dates = useMemo(
    () => Array.from({ length: periodDays }, (_, i) => addDaysISO(rangeStartISO, i)),
    [periodDays, rangeStartISO]
  );

  const wilayahOptions = useMemo(() => [...new Set(cells.map((c) => c.Wilayah))].sort(), [cells]);
  const kecamatanOptions = useMemo(
    () =>
      [
        ...new Set(
          cells
            .filter((c) => wilayahFilter === ALL || c.Wilayah === wilayahFilter)
            .map((c) => c.Kecamatan)
            .filter((k): k is string => !!k)
        ),
      ].sort(),
    [cells, wilayahFilter]
  );

  function handleWilayahChange(next: string) {
    setWilayahFilter(next);
    setKecamatanFilter(ALL); // same "changing Wilayah clears Kecamatan" pattern used elsewhere
  }

  const filteredCells = useMemo(
    () =>
      cells.filter(
        (c) =>
          (wilayahFilter === ALL || c.Wilayah === wilayahFilter) &&
          (kecamatanFilter === ALL || c.Kecamatan === kecamatanFilter)
      ),
    [cells, wilayahFilter, kecamatanFilter]
  );

  const rows: AggregatedRow[] = useMemo(() => {
    const byMarketing = new Map<string, MarketingScopeCell & { DailyQty: number[] }>();
    for (const c of filteredCells) {
      let entry = byMarketing.get(c.MarketingUserID);
      if (!entry) {
        entry = { ...c, DailyQty: new Array(periodDays).fill(0) };
        byMarketing.set(c.MarketingUserID, entry);
      } else {
        entry.TargetHarian += c.TargetHarian;
      }
      for (let i = 0; i < periodDays; i++) entry.DailyQty[i] += c.DailyQty[i];
    }
    return [...byMarketing.values()]
      .map((entry) => {
        const totalQty = entry.DailyQty.reduce((sum, q) => sum + q, 0);
        const targetPeriode = entry.TargetHarian * periodDays;
        return {
          MarketingUserID: entry.MarketingUserID,
          MarketingNama: entry.MarketingNama,
          TargetHarian: entry.TargetHarian,
          DailyQty: entry.DailyQty,
          TotalQty: totalQty,
          PctAchievement: targetPeriode ? (totalQty / targetPeriode) * 100 : null,
        };
      })
      .sort((a, b) => b.TotalQty - a.TotalQty);
  }, [filteredCells, periodDays]);

  const totalPerDate = useMemo(() => {
    const totals = new Array(periodDays).fill(0);
    for (const r of rows) {
      for (let i = 0; i < periodDays; i++) totals[i] += r.DailyQty[i];
    }
    return totals;
  }, [rows, periodDays]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display">Kinerja Marketing</CardTitle>
            <CardDescription>
              Total QTY DO harian dari seluruh mitra dalam cakupan wilayah &amp; kecamatan tiap Marketing, periode{" "}
              {rangeStartISO} &ndash; {addDaysISO(rangeStartISO, periodDays - 1)}.
            </CardDescription>
          </div>
          {canManageSettings && <PeriodSettings rangeStartISO={rangeStartISO} periodDays={periodDays} />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Select value={wilayahFilter} onValueChange={(v) => handleWilayahChange(v ?? ALL)}>
            <SelectTrigger className="w-44" aria-label="Wilayah">
              <SelectValue>{(v: string) => (v === ALL ? "Semua Wilayah" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Wilayah</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kecamatanFilter} onValueChange={(v) => setKecamatanFilter(v ?? ALL)} disabled={kecamatanOptions.length === 0}>
            <SelectTrigger className="w-44" aria-label="Kecamatan">
              <SelectValue>{(v: string) => (v === ALL ? "Semua Kecamatan" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Kecamatan</SelectItem>
              {kecamatanOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada Marketing dengan cakupan wilayah yang diatur.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-0 border-b pb-2">
              <div
                className={cn(
                  "sticky left-0 z-10 shrink-0 self-center bg-card pr-3 text-xs font-medium text-muted-foreground",
                  INFO_COL_CLASS
                )}
              >
                Total per Tanggal
              </div>
              <div className="flex border-l">
                {dates.map((dateISO, i) => (
                  <div
                    key={dateISO}
                    className={cn(
                      "flex shrink-0 items-center justify-center border-r text-[10px] font-semibold tabular-nums text-primary",
                      DAY_COL_CLASS
                    )}
                  >
                    {formatQty(totalPerDate[i])}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col divide-y">
              {rows.map((r) => (
                <MarketingCard key={r.MarketingUserID} row={r} kpi={kpiByUserId.get(r.MarketingUserID)} dates={dates} todayISO={todayISO} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
