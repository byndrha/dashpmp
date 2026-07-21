"use client";

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            {m.Wilayah}
            {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Harga {m.HargaJual != null ? formatRupiah(m.HargaJual) : "-"} · Target Harian{" "}
            {m.TargetHarian != null ? formatQty(m.TargetHarian) : "-"} · Target Bulanan{" "}
            {m.TargetBulanan != null ? formatQty(m.TargetBulanan) : "-"}
          </p>
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
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Transaksi DO per Mitra — Bulan Berjalan</CardTitle>
        <CardDescription>
          Pengambilan (DO) tiap mitra per tanggal dibanding target harian (dari Kapasitas mitra). Hijau = target
          tercapai, merah = belum tercapai. Kemasan 5KG dihitung setengah kantong (mengikuti kantong 10KG).
        </CardDescription>
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

        {inactive.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll((v) => !v)}>
            <Users className="size-3.5" />
            {showAll ? "Sembunyikan" : "Tampilkan"} {inactive.length} mitra tanpa transaksi bulan ini
            <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
