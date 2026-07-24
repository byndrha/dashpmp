"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Users, TrendingUp, TrendingDown, Minus, ArrowUpDown, Search } from "lucide-react";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitraDOMonthly, MitraDORow } from "@/lib/queries/mitra-do";

type SortMode = "terbanyak" | "tren" | "terbaru";

const SORT_LABEL: Record<SortMode, string> = {
  terbanyak: "Pengambilan Terbanyak",
  tren: "Tren 3 Hari Terakhir",
  terbaru: "Mitra Terbaru",
};

// Fixed width for the sticky-left info column, shared between the header
// spacer and every row's info block so the date columns line up exactly.
const INFO_COL_CLASS = "w-52 sm:w-56";
// Fixed width for each date column, shared between the header's per-date
// total cells and every row's DayChip so both line up exactly.
const DAY_COL_CLASS = "h-11 w-12";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Compares the sum of the latest 3 elapsed days against the 3 days before
// that — a simple period-over-period read on whether a mitra's pickups are
// trending up or down, not just their running total. Needs at least 6 days
// elapsed in the filtered range for a fair comparison; before that there's
// no "previous 3 days" window yet, so it reports flat rather than guessing.
function getTrend(dailyQty: number[], elapsedDays: number): { direction: "up" | "down" | "flat"; delta: number } {
  const latestStart = elapsedDays - 3;
  const prevStart = elapsedDays - 6;
  if (prevStart < 0) return { direction: "flat", delta: 0 };
  const latest = dailyQty.slice(latestStart, elapsedDays).reduce((sum, q) => sum + q, 0);
  const previous = dailyQty.slice(prevStart, latestStart).reduce((sum, q) => sum + q, 0);
  const delta = latest - previous;
  return { direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat", delta };
}

function TrendIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") return <TrendingUp className="mt-0.5 inline-block size-3.5 text-primary" />;
  if (direction === "down") return <TrendingDown className="mt-0.5 inline-block size-3.5 text-destructive" />;
  return <Minus className="mt-0.5 inline-block size-3.5 text-muted-foreground/40" />;
}

// Right-border-only cells (no rounded chip look) so adjacent cells across
// every row in the list line up into continuous vertical divider lines,
// per-date, running from the header total row down through the whole list.
function DayChip({ dateISO, qty, target, isPast }: { dateISO: string; qty: number; target: number | null; isPast: boolean }) {
  const state = !isPast ? "future" : target == null ? "neutral" : qty >= target ? "hit" : "miss";
  const day = Number(dateISO.slice(8, 10));
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-0.5 border-r text-[10px] tabular-nums",
        DAY_COL_CLASS,
        state === "hit" && "bg-primary/10 text-primary",
        state === "miss" && "bg-destructive/10 text-destructive",
        state === "future" && "text-muted-foreground/50",
        state === "neutral" && "text-muted-foreground"
      )}
    >
      <span className="opacity-60">{day}</span>
      <span className="font-semibold">{isPast ? formatQty(qty) : "-"}</span>
    </div>
  );
}

// Newest JoinDate first; mitra with no JoinDate on record (older
// ERP-imported rows this app didn't create) sort last rather than
// clumping at the top as a false "newest".
function compareJoinDateDesc(a: MitraDORow, b: MitraDORow): number {
  if (!a.JoinDate && !b.JoinDate) return 0;
  if (!a.JoinDate) return 1;
  if (!b.JoinDate) return -1;
  return new Date(b.JoinDate).getTime() - new Date(a.JoinDate).getTime();
}

function MitraDOCard({
  m,
  dates,
  todayISO,
  elapsedDays,
}: {
  m: MitraDORow;
  dates: string[];
  todayISO: string;
  elapsedDays: number;
}) {
  const trend = getTrend(m.DailyQty, elapsedDays);
  return (
    <div className="flex items-stretch">
      {/* Sticky within the shared horizontal-scroll ancestor (not the page)
          — stays pinned to the left edge of the scroll viewport while the
          date columns to its right scroll underneath it. bg-card keeps
          scrolled-under cells from showing through. Total/%/trend paired
          on the right of each line (not a separate 4th line) to fit
          everything in this narrower fixed-width column. */}
      <div className={cn("sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 bg-card py-3 pr-3", INFO_COL_CLASS)}>
        <div className="flex items-start justify-between gap-1">
          <p className="flex min-w-0 items-center gap-1.5 font-medium">
            <span className="truncate">{m.Name}</span>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
              {m.PartnerType}
            </Badge>
          </p>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{formatQty(m.TotalQty)}</span>
        </div>
        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          <span className="truncate">
            {m.Wilayah}
            {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {m.PctAchievement != null ? `${m.PctAchievement.toFixed(0)}%` : "-"}
            <TrendIcon direction={trend.direction} />
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          Harga {m.HargaJual != null ? formatRupiah(m.HargaJual) : "-"} · Target Harian{" "}
          {m.TargetHarian != null ? formatQty(m.TargetHarian) : "-"}
        </p>
      </div>
      <div className="flex border-l">
        {dates.map((dateISO, i) => (
          <DayChip key={dateISO} dateISO={dateISO} qty={m.DailyQty[i]} target={m.TargetHarian} isPast={dateISO <= todayISO} />
        ))}
      </div>
    </div>
  );
}

export function MitraDOPanel({
  data,
  wilayahFilter,
  onWilayahFilterChange,
}: {
  data: MitraDOMonthly;
  wilayahFilter: string;
  onWilayahFilterChange: (wilayah: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("terbanyak");
  const [search, setSearch] = useState("");
  const { active, inactive, daysInRange, rangeStartISO, todayISO } = data;
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(
    () => Array.from({ length: daysInRange }, (_, i) => addDaysISO(rangeStartISO, i)),
    [daysInRange, rangeStartISO]
  );

  // How many days of the visible range have elapsed (clamped to the range
  // itself) — feeds the "Tren 3 Hari Terakhir" sort, which needs a plain
  // count, not a date.
  const elapsedDays = useMemo(() => {
    const todayIndex = Math.round((new Date(todayISO).getTime() - new Date(rangeStartISO).getTime()) / 86400000);
    return Math.min(daysInRange, Math.max(0, todayIndex + 1));
  }, [todayISO, rangeStartISO, daysInRange]);

  const wilayahOptions = useMemo(
    () => [...new Set([...active, ...inactive].map((m) => m.Wilayah))].sort(),
    [active, inactive]
  );

  const searchQuery = search.trim().toLowerCase();
  const filteredActive = useMemo(() => {
    const byWilayah = wilayahFilter === "all" ? active : active.filter((m) => m.Wilayah === wilayahFilter);
    return searchQuery ? byWilayah.filter((m) => m.Name.toLowerCase().includes(searchQuery)) : byWilayah;
  }, [active, wilayahFilter, searchQuery]);
  const filteredInactive = useMemo(() => {
    const byWilayah = wilayahFilter === "all" ? inactive : inactive.filter((m) => m.Wilayah === wilayahFilter);
    return searchQuery ? byWilayah.filter((m) => m.Name.toLowerCase().includes(searchQuery)) : byWilayah;
  }, [inactive, wilayahFilter, searchQuery]);

  // Reflects whatever the Wilayah filter currently shows, not the
  // unfiltered total — matches what the user is actually looking at.
  const totalKantong = useMemo(() => filteredActive.reduce((sum, m) => sum + m.TotalQty, 0), [filteredActive]);

  const totalPerDate = useMemo(() => {
    const totals = new Array(daysInRange).fill(0);
    for (const m of filteredActive) {
      for (let i = 0; i < daysInRange; i++) totals[i] += m.DailyQty[i];
    }
    return totals;
  }, [filteredActive, daysInRange]);

  // filteredActive already arrives sorted by TotalQty desc (the
  // "Pengambilan Terbanyak" mode) — only re-sort for the other modes, so
  // the default path stays a no-op.
  const sortedActive = useMemo(() => {
    if (sortMode === "terbanyak") return filteredActive;
    if (sortMode === "terbaru") return [...filteredActive].sort(compareJoinDateDesc);
    return [...filteredActive].sort(
      (a, b) => getTrend(b.DailyQty, elapsedDays).delta - getTrend(a.DailyQty, elapsedDays).delta
    );
  }, [filteredActive, sortMode, elapsedDays]);

  // One-way mirror: the body's own horizontal scrollbar is what the user
  // actually drags; the header's date-total row has no scrollbar of its
  // own (overflow-x-hidden) and just has its scrollLeft driven to match,
  // so both stay visually locked together as one continuous grid even
  // though they live in separate sticky/non-sticky DOM regions.
  function handleBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  return (
    // Plain div standing in for <Card> here, minus `overflow-hidden` — Card
    // sets that for rounded-corner clipping, but it also turns Card into a
    // clipping/scroll-container ancestor for the sticky CardHeader below,
    // which made the header cover the first row of content even at rest
    // (not just while scrolling). Everything else matches Card's own classes.
    <div className="flex flex-col gap-(--card-spacing) rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 shadow-md [--card-spacing:--spacing(4)]">
      {/* Sticky within this div's own bounds (its containing block) — stays
          pinned below the app header while scrolling through the mitra list
          in CardContent, and lets go once this div's bottom comes into view. */}
      <CardHeader className="sticky top-14 z-20 border-b bg-card pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-display">Transaksi DO per Mitra — Bulan Berjalan</CardTitle>
          <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
            {formatQty(totalKantong)} kantong
          </p>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Tercapai
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            Belum tercapai
          </span>
          <span>(Kemasan 5KG telah dikonversi)</span>
        </CardDescription>
        {/* Lives inside the sticky CardHeader (not CardContent) so both stay
            reachable at every scroll position within this panel, not just
            near the bottom — a bottom-sticky button here had nothing left
            below it in the flow to stick against, so it never actually
            engaged until you'd already scrolled past the whole list. */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama mitra..."
              className="h-9 pl-8 text-xs"
            />
          </div>
          <Select value={sortMode} onValueChange={(v) => setSortMode((v as SortMode) ?? "terbanyak")}>
            <SelectTrigger className="w-56" aria-label="Urutkan">
              <ArrowUpDown className="size-3.5 text-muted-foreground" />
              <SelectValue>{(v: string) => SORT_LABEL[v as SortMode] ?? SORT_LABEL.terbanyak}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="terbanyak">{SORT_LABEL.terbanyak}</SelectItem>
              <SelectItem value="tren">{SORT_LABEL.tren}</SelectItem>
              <SelectItem value="terbaru">{SORT_LABEL.terbaru}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={wilayahFilter} onValueChange={(v) => onWilayahFilterChange(v ?? "all")}>
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
          {filteredInactive.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              <Users className="size-3.5" />
              {showAll ? "Sembunyikan" : "Tampilkan"} {filteredInactive.length} mitra tanpa transaksi bulan ini
              <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
            </Button>
          )}
        </div>
        {/* Per-date total row — mirrors the body's horizontal scroll (see
            handleBodyScroll) so it always lines up with the date columns
            below it, while staying put in the sticky header itself. */}
        <div className="mt-2 flex min-w-0 border-t pt-2">
          <div className={cn("shrink-0 self-center pr-3 text-xs font-medium text-muted-foreground", INFO_COL_CLASS)}>
            Total per Tanggal
          </div>
          <div ref={headerScrollRef} className="flex min-w-0 flex-1 overflow-x-hidden border-l">
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
      </CardHeader>
      <CardContent>
        {filteredActive.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada Delivery Order bulan ini.</p>
        ) : (
          <div ref={bodyScrollRef} onScroll={handleBodyScroll} className="overflow-x-auto">
            <div className="flex flex-col divide-y">
              {sortedActive.map((m) => (
                <MitraDOCard key={m.BusinessPartnerID} m={m} dates={dates} todayISO={todayISO} elapsedDays={elapsedDays} />
              ))}
            </div>

            {showAll && filteredInactive.length > 0 && (
              <div className="flex flex-col divide-y border-t">
                {filteredInactive.map((m) => (
                  <MitraDOCard key={m.BusinessPartnerID} m={m} dates={dates} todayISO={todayISO} elapsedDays={elapsedDays} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </div>
  );
}
