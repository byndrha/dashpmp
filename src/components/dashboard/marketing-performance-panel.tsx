"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, ArrowDown, Settings2, Star, Users, ChevronDown, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MitraDetailDialog } from "@/components/dashboard/mitra-detail-dialog";
import { cn } from "@/lib/utils";
import type { MarketingPerformanceData, MarketingScopeCell, MarketingScopeAllMitra } from "@/lib/queries/marketing-performance";
import type { MarketingKPIRow } from "@/lib/queries/mitra-pengajuan";
import type { MarketingMitraAssignment } from "@/lib/queries/marketing-wilayah";
import {
  setMarketingPeriodSettingAction,
  getMarketingVisitLogAction,
  saveMarketingVisitLogAction,
} from "@/app/(dashboard)/pemasaran/actions";

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

// Calendar date + qty + explicit +/- delta against the immediately
// preceding day — used for the Marketing-level aggregate row, which isn't
// tied to a single mitra so has no visit-log affordance.
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

// Same lazy-fetch-on-open pattern as Transaksi's ContactLogButton
// (mitra-do-panel.tsx), but for a Marketing's own visit note rather than an
// order-negotiation log. Only rendered on per-mitra rows (priority or
// full-roster) — a visit is tied to one mitra, so the Marketing-level
// aggregate row above uses the plain DayCell instead.
//
// The whole day cell is the click target (not a small icon) — per explicit
// request to remove the separate Log Kunjungan foot icon and let clicking
// the mitra's date area open the same log.
function MitraDayCell({
  dateISO,
  qty,
  prevQty,
  isPast,
  businessPartnerId,
}: {
  dateISO: string;
  qty: number;
  prevQty: number | null;
  isPast: boolean;
  businessPartnerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasEntry, setHasEntry] = useState(false);
  const [hasilKunjungan, setHasilKunjungan] = useState("");
  const [pending, startTransition] = useTransition();
  const delta = isPast && prevQty != null ? qty - prevQty : null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoading(true);
    getMarketingVisitLogAction(businessPartnerId, dateISO)
      .then((entry) => {
        setHasEntry(!!entry);
        setHasilKunjungan(entry?.HasilKunjungan ?? "");
      })
      .catch(() => toast.error("Gagal memuat catatan kunjungan."))
      .finally(() => setLoading(false));
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveMarketingVisitLogAction({ businessPartnerId, dateISO, hasilKunjungan: hasilKunjungan.trim() || null });
        setHasEntry(true);
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menyimpan catatan kunjungan.");
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Klik untuk catat kunjungan"
            className={cn(
              "relative flex shrink-0 flex-col items-center justify-center gap-0.5 border-r text-[10px] tabular-nums transition-colors hover:bg-accent/50",
              DAY_COL_CLASS
            )}
          />
        }
      >
        {hasEntry && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />}
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
      </PopoverTrigger>
      <PopoverContent className="w-64" align="center">
        <p className="mb-2 text-xs font-medium">
          Log Kunjungan &mdash; {dateISO.slice(8, 10)}/{dateISO.slice(5, 7)}/{dateISO.slice(0, 4)}
        </p>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Memuat...
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Hasil Kunjungan</Label>
              <Textarea
                value={hasilKunjungan}
                onChange={(e) => setHasilKunjungan(e.target.value)}
                rows={3}
                className="text-xs"
                placeholder="Apa hasil kunjungan ke mitra ini..."
              />
            </div>
            <Button size="sm" disabled={pending} onClick={handleSave} className="mt-1">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Priority mitra assigned to this Marketing (see MitraPrioritasSection's old
// job), collapsed by default — a secondary drill-down, not the primary
// per-Marketing row above it. Sorted by highest target (Capacity) first.
function MitraPrioritasRow({
  mitra,
  dailyQty,
  dates,
  todayISO,
  onMitraClick,
}: {
  mitra: MarketingMitraAssignment;
  dailyQty: number[];
  dates: string[];
  todayISO: string;
  onMitraClick: (businessPartnerId: string) => void;
}) {
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => onMitraClick(mitra.BusinessPartnerID)}
        className={cn(
          "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 bg-card py-2 pr-3 pl-6 text-left transition-colors hover:bg-accent/50",
          INFO_COL_CLASS
        )}
      >
        <p className="flex min-w-0 items-center gap-1 truncate text-xs font-medium">
          <Star className="size-3 shrink-0 fill-primary text-primary" />
          <span className="truncate">{mitra.MitraName}</span>
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {mitra.Wilayah}
          {mitra.Kecamatan ? ` · ${mitra.Kecamatan}` : ""} · Target {mitra.Capacity != null ? formatQty(mitra.Capacity) : "-"}
        </p>
      </button>
      <div className="flex border-l">
        {dates.map((dateISO, i) => (
          <MitraDayCell
            key={dateISO}
            dateISO={dateISO}
            qty={dailyQty[i] ?? 0}
            prevQty={i > 0 ? (dailyQty[i - 1] ?? 0) : null}
            isPast={dateISO <= todayISO}
            businessPartnerId={mitra.BusinessPartnerID}
          />
        ))}
      </div>
    </div>
  );
}

// Full roster of every mitra resolved into this Marketing's Wilayah/Kecamatan
// scope (not just the curated priority set) — same row shape as
// MitraPrioritasRow, minus the priority Star marker.
function AllMitraRow({
  mitra,
  dailyQty,
  dates,
  todayISO,
  onMitraClick,
}: {
  mitra: MarketingScopeAllMitra;
  dailyQty: number[];
  dates: string[];
  todayISO: string;
  onMitraClick: (businessPartnerId: string) => void;
}) {
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => onMitraClick(mitra.BusinessPartnerID)}
        className={cn(
          "sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 bg-card py-2 pr-3 pl-6 text-left transition-colors hover:bg-accent/50",
          INFO_COL_CLASS
        )}
      >
        <p className="truncate text-xs font-medium">{mitra.Name}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {mitra.Wilayah}
          {mitra.Kecamatan ? ` · ${mitra.Kecamatan}` : ""} · Target {mitra.Capacity != null ? formatQty(mitra.Capacity) : "-"}
        </p>
      </button>
      <div className="flex border-l">
        {dates.map((dateISO, i) => (
          <MitraDayCell
            key={dateISO}
            dateISO={dateISO}
            qty={dailyQty[i] ?? 0}
            prevQty={i > 0 ? (dailyQty[i - 1] ?? 0) : null}
            isPast={dateISO <= todayISO}
            businessPartnerId={mitra.BusinessPartnerID}
          />
        ))}
      </div>
    </div>
  );
}

function MarketingCard({
  row,
  kpi,
  dates,
  todayISO,
  mitraPrioritas,
  allMitra,
  mitraDailyQty,
  onMitraClick,
}: {
  row: AggregatedRow;
  kpi: MarketingKPIRow | undefined;
  dates: string[];
  todayISO: string;
  mitraPrioritas: MarketingMitraAssignment[];
  allMitra: MarketingScopeAllMitra[];
  mitraDailyQty: Record<string, number[]>;
  onMitraClick: (businessPartnerId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const kunjungan = kpi?.Kunjungan ?? 0;
  const konversiPct = kpi && kpi.Kunjungan > 0 ? (kpi.Konversi / kpi.Kunjungan) * 100 : 0;
  const sortedMitra = useMemo(() => [...mitraPrioritas].sort(compareCapacityDesc), [mitraPrioritas]);
  const sortedAllMitra = useMemo(() => [...allMitra].sort(compareCapacityDesc), [allMitra]);

  return (
    <div className="flex flex-col">
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

      {sortedMitra.length > 0 && (
        <div className="pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 pl-3 text-[11px] text-muted-foreground"
            onClick={() => setOpen((v) => !v)}
          >
            <Star className="size-3 fill-primary text-primary" />
            {open ? "Sembunyikan" : "Tampilkan"} {sortedMitra.length} mitra prioritas
            <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
          </Button>
          {open && (
            <div className="flex flex-col divide-y border-t">
              {sortedMitra.map((m) => (
                <MitraPrioritasRow
                  key={m.MarketingMitraID}
                  mitra={m}
                  dailyQty={mitraDailyQty[m.BusinessPartnerID] ?? []}
                  dates={dates}
                  todayISO={todayISO}
                  onMitraClick={onMitraClick}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {sortedAllMitra.length > 0 && (
        <div className="pb-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 pl-3 text-[11px] text-muted-foreground"
            onClick={() => setOpenAll((v) => !v)}
          >
            <Users className="size-3" />
            {openAll ? "Sembunyikan" : "Tampilkan"} {sortedAllMitra.length} seluruh mitra
            <ChevronDown className={cn("size-3 transition-transform", openAll && "rotate-180")} />
          </Button>
          {openAll && (
            <div className="flex flex-col divide-y border-t">
              {sortedAllMitra.map((m) => (
                <AllMitraRow
                  key={m.BusinessPartnerID}
                  mitra={m}
                  dailyQty={mitraDailyQty[m.BusinessPartnerID] ?? []}
                  dates={dates}
                  todayISO={todayISO}
                  onMitraClick={onMitraClick}
                />
              ))}
            </div>
          )}
        </div>
      )}
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

// Highest target (Capacity) first; mitra with no target set sort last
// rather than clumping at the top as a false "highest" — same convention as
// mitra-do-panel.tsx's compareTargetDesc.
function compareCapacityDesc(a: { Capacity: number | null }, b: { Capacity: number | null }): number {
  if (a.Capacity == null && b.Capacity == null) return 0;
  if (a.Capacity == null) return 1;
  if (b.Capacity == null) return -1;
  return b.Capacity - a.Capacity;
}

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
  mitraAssignments,
}: {
  data: MarketingPerformanceData;
  kpiRows: MarketingKPIRow[];
  canManageSettings: boolean;
  mitraAssignments: MarketingMitraAssignment[];
}) {
  const { cells, periodDays, rangeStartISO, todayISO, mitraDailyQty, allMitraByMarketing } = data;
  const [wilayahFilter, setWilayahFilter] = useState(ALL);
  const [kecamatanFilter, setKecamatanFilter] = useState(ALL);
  const [detailMitraId, setDetailMitraId] = useState<string | null>(null);

  const kpiByUserId = useMemo(() => new Map(kpiRows.map((r) => [r.UserID, r])), [kpiRows]);
  const mitraByMarketing = useMemo(() => {
    const map = new Map<string, MarketingMitraAssignment[]>();
    for (const a of mitraAssignments) {
      const list = map.get(a.MarketingUserID);
      if (list) list.push(a);
      else map.set(a.MarketingUserID, [a]);
    }
    return map;
  }, [mitraAssignments]);

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

  // Only mitra belonging to a Marketing currently shown (respects the
  // Wilayah/Kecamatan filters same as totalPerDate/rows above).
  const visibleMitraIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) {
      for (const m of allMitraByMarketing[r.MarketingUserID] ?? []) ids.add(m.BusinessPartnerID);
    }
    return ids;
  }, [rows, allMitraByMarketing]);

  // Sum of positive and negative day-over-day deltas across every visible
  // mitra individually — a SUM of per-mitra swings, not a row count. E.g.
  // mitra A +60, B -20, C +30 vs the day before -> (+90) (-20) for that date.
  const deltaPerDate = useMemo(() => {
    const positive = new Array(periodDays).fill(0);
    const negative = new Array(periodDays).fill(0);
    for (const id of visibleMitraIds) {
      const arr = mitraDailyQty[id];
      if (!arr) continue;
      for (let i = 1; i < periodDays; i++) {
        const delta = (arr[i] ?? 0) - (arr[i - 1] ?? 0);
        if (delta > 0) positive[i] += delta;
        else if (delta < 0) negative[i] += delta;
      }
    }
    return { positive, negative };
  }, [visibleMitraIds, mitraDailyQty, periodDays]);

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
                      "flex shrink-0 flex-col items-center justify-center gap-0.5 border-r text-[10px] font-semibold tabular-nums text-primary",
                      DAY_COL_CLASS
                    )}
                  >
                    <span>{formatQty(totalPerDate[i])}</span>
                    {i > 0 && (deltaPerDate.positive[i] > 0 || deltaPerDate.negative[i] < 0) && (
                      <span className="flex items-center gap-1 text-[9px] font-normal">
                        {deltaPerDate.positive[i] > 0 && <span>(+{formatQty(deltaPerDate.positive[i])})</span>}
                        {deltaPerDate.negative[i] < 0 && (
                          <span className="text-destructive">({formatQty(deltaPerDate.negative[i])})</span>
                        )}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col divide-y">
              {rows.map((r) => (
                <MarketingCard
                  key={r.MarketingUserID}
                  row={r}
                  kpi={kpiByUserId.get(r.MarketingUserID)}
                  dates={dates}
                  todayISO={todayISO}
                  mitraPrioritas={mitraByMarketing.get(r.MarketingUserID) ?? []}
                  allMitra={allMitraByMarketing[r.MarketingUserID] ?? []}
                  mitraDailyQty={mitraDailyQty}
                  onMitraClick={setDetailMitraId}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
      <MitraDetailDialog businessPartnerId={detailMitraId} onOpenChange={(open) => !open && setDetailMitraId(null)} />
    </Card>
  );
}
