"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Users, TrendingUp, TrendingDown, Minus, ArrowUpDown } from "lucide-react";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

// Compares the sum of the latest 3 recorded days against the 3 days before
// that — a simple period-over-period read on whether a mitra's pickups are
// trending up or down, not just their running total. Needs at least 6 days
// of the month elapsed for a fair comparison; before that there's no
// "previous 3 days" window yet, so it reports flat rather than guessing.
function getTrend(dailyQty: number[], currentDay: number): { direction: "up" | "down" | "flat"; delta: number } {
  const latestStart = currentDay - 3;
  const prevStart = currentDay - 6;
  if (prevStart < 0) return { direction: "flat", delta: 0 };
  const latest = dailyQty.slice(latestStart, currentDay).reduce((sum, q) => sum + q, 0);
  const previous = dailyQty.slice(prevStart, latestStart).reduce((sum, q) => sum + q, 0);
  const delta = latest - previous;
  return { direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat", delta };
}

function TrendIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") return <TrendingUp className="mt-0.5 inline-block size-3.5 text-primary" />;
  if (direction === "down") return <TrendingDown className="mt-0.5 inline-block size-3.5 text-destructive" />;
  return <Minus className="mt-0.5 inline-block size-3.5 text-muted-foreground/40" />;
}

function DayChip({ day, qty, target, isPast }: { day: number; qty: number; target: number | null; isPast: boolean }) {
  const state = !isPast ? "future" : target == null ? "neutral" : qty >= target ? "hit" : "miss";
  return (
    <div
      className={cn(
        "flex h-11 w-9 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border text-[10px] tabular-nums",
        state === "hit" && "border-primary/30 bg-primary/10 text-primary",
        state === "miss" && "border-destructive/30 bg-destructive/10 text-destructive",
        state === "future" && "border-dashed text-muted-foreground/50",
        state === "neutral" && "text-muted-foreground"
      )}
    >
      <span className="opacity-60">{day}</span>
      <span className="font-semibold">{isPast ? formatQty(qty) : "-"}</span>
    </div>
  );
}

function MitraDOCard({ m, currentDay }: { m: MitraDORow; currentDay: number }) {
  return (
    <div className="flex flex-col gap-1.5 py-3">
      {/* Name + Total/%/trend never wrap onto separate lines (no
          flex-wrap here) — that's what let the right-hand block collapse
          below the Harga/Target line on narrow mobile widths before. The
          name truncates instead of pushing the right block down. */}
      <div className="flex items-start justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 font-medium">
          <span className="truncate">{m.Name}</span>
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
            {m.PartnerType}
          </Badge>
        </p>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">{formatQty(m.TotalQty)} kantong</p>
          <p className="text-xs font-medium text-muted-foreground">
            {m.PctAchievement != null ? `${m.PctAchievement.toFixed(1)}% capaian` : "- capaian"}
          </p>
          <TrendIcon direction={getTrend(m.DailyQty, currentDay).direction} />
        </div>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>
          {m.Wilayah}
          {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
        </span>
        <span>
          Harga {m.HargaJual != null ? formatRupiah(m.HargaJual) : "-"} · Target Harian{" "}
          {m.TargetHarian != null ? formatQty(m.TargetHarian) : "-"} · Target Bulanan{" "}
          {m.TargetBulanan != null ? formatQty(m.TargetBulanan) : "-"}
        </span>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {m.DailyQty.map((qty, i) => (
          <DayChip key={i} day={i + 1} qty={qty} target={m.TargetHarian} isPast={i + 1 <= currentDay} />
        ))}
      </div>
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

export function MitraDOPanel({ data }: { data: MitraDOMonthly }) {
  const [showAll, setShowAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("terbanyak");
  const [wilayahFilter, setWilayahFilter] = useState("all");
  const { active, inactive, currentDay } = data;

  const wilayahOptions = useMemo(
    () => [...new Set([...active, ...inactive].map((m) => m.Wilayah))].sort(),
    [active, inactive]
  );

  const filteredActive = useMemo(
    () => (wilayahFilter === "all" ? active : active.filter((m) => m.Wilayah === wilayahFilter)),
    [active, wilayahFilter]
  );
  const filteredInactive = useMemo(
    () => (wilayahFilter === "all" ? inactive : inactive.filter((m) => m.Wilayah === wilayahFilter)),
    [inactive, wilayahFilter]
  );

  // filteredActive already arrives sorted by TotalQty desc (the
  // "Pengambilan Terbanyak" mode) — only re-sort for the other modes, so
  // the default path stays a no-op.
  const sortedActive = useMemo(() => {
    if (sortMode === "terbanyak") return filteredActive;
    if (sortMode === "terbaru") return [...filteredActive].sort(compareJoinDateDesc);
    return [...filteredActive].sort(
      (a, b) => getTrend(b.DailyQty, currentDay).delta - getTrend(a.DailyQty, currentDay).delta
    );
  }, [filteredActive, sortMode, currentDay]);

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
        <CardTitle className="font-display">Transaksi DO per Mitra — Bulan Berjalan</CardTitle>
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
          {filteredInactive.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              <Users className="size-3.5" />
              {showAll ? "Sembunyikan" : "Tampilkan"} {filteredInactive.length} mitra tanpa transaksi bulan ini
              <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {filteredActive.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada Delivery Order bulan ini.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {sortedActive.map((m) => (
              <MitraDOCard key={m.BusinessPartnerID} m={m} currentDay={currentDay} />
            ))}
          </div>
        )}

        {showAll && filteredInactive.length > 0 && (
          <div className="flex flex-col divide-y border-t">
            {filteredInactive.map((m) => (
              <MitraDOCard key={m.BusinessPartnerID} m={m} currentDay={currentDay} />
            ))}
          </div>
        )}
      </CardContent>
    </div>
  );
}
