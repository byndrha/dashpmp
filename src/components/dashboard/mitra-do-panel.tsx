"use client";

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitraDOMonthly, MitraDORow } from "@/lib/queries/mitra-do";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
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
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            {m.Name}
            <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
              {m.PartnerType}
            </Badge>
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
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
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums">{formatQty(m.TotalQty)} kantong</p>
          <p className="text-xs font-medium text-muted-foreground">
            {m.PctAchievement != null ? `${m.PctAchievement.toFixed(1)}% capaian` : "- capaian"}
          </p>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto pb-1">
        {m.DailyQty.map((qty, i) => (
          <DayChip key={i} day={i + 1} qty={qty} target={m.TargetHarian} isPast={i + 1 <= currentDay} />
        ))}
      </div>
    </div>
  );
}

export function MitraDOPanel({ data }: { data: MitraDOMonthly }) {
  const [showAll, setShowAll] = useState(false);
  const { active, inactive, currentDay } = data;

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
        {/* Lives inside the sticky CardHeader (not CardContent) so it's
            reachable at every scroll position within this panel, not just
            near the bottom — a bottom-sticky button here had nothing left
            below it in the flow to stick against, so it never actually
            engaged until you'd already scrolled past the whole list. */}
        {inactive.length > 0 && (
          <Button variant="outline" size="sm" className="mt-1 self-start" onClick={() => setShowAll((v) => !v)}>
            <Users className="size-3.5" />
            {showAll ? "Sembunyikan" : "Tampilkan"} {inactive.length} mitra tanpa transaksi bulan ini
            <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada Delivery Order bulan ini.</p>
        ) : (
          <div className="flex flex-col divide-y">
            {active.map((m) => (
              <MitraDOCard key={m.BusinessPartnerID} m={m} currentDay={currentDay} />
            ))}
          </div>
        )}

        {showAll && inactive.length > 0 && (
          <div className="flex flex-col divide-y border-t">
            {inactive.map((m) => (
              <MitraDOCard key={m.BusinessPartnerID} m={m} currentDay={currentDay} />
            ))}
          </div>
        )}
      </CardContent>
    </div>
  );
}
