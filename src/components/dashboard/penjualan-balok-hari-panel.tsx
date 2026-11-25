"use client";

// Padanan SalesTodayPanel (Es Kristal) untuk Es Balok: nominal hari itu,
// balok terjual (kecil/besar), jumlah pesanan & agen, harga rata-rata per
// jenis balok, dan tabel VS Tanggal (kemarin, bulan lalu, tahun lalu, dua
// tahun lalu). Navigasi hari lewat `loadDay`
// (server action milik halaman PT masing-masing).
import { Fragment, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, ClipboardList, Users, Box, Coins, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocChip, TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah, formatRupiahAvg, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PenjualanBalokHari } from "@/lib/queries/penjualan-es-balok";

const dayFormatter = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const compactRupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Sesuai urutan PenjualanBalokHari.pembanding.
const KETERANGAN_PEMBANDING = ["Kemarin", "Tanggal yang sama bulan lalu", "Tanggal yang sama tahun lalu", "Tanggal yang sama dua tahun lalu"];

function pctChange(now: number, before: number): number | null {
  return before ? ((now - before) / before) * 100 : null;
}

function shiftDateISO(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function GrowthBadge({ percent, delta }: { percent: number | null; delta: number }) {
  if (percent == null) return null;
  const up = percent > 0;
  const down = percent < 0;
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium",
          up && "bg-primary/15 text-primary",
          down && "bg-destructive/15 text-destructive",
          !up && !down && "bg-secondary text-muted-foreground"
        )}
      >
        {up && <TrendingUp className="size-3" />}
        {down && <TrendingDown className="size-3" />}
        {!up && !down && <Minus className="size-3" />}
        {formatPercentPoints(Math.abs(percent))}
      </TooltipTrigger>
      <TooltipContent>
        {delta >= 0 ? "+" : ""}
        {formatRupiah(delta)} vs tanggal sama bulan lalu
      </TooltipContent>
    </Tooltip>
  );
}

export function BalokChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
      <Box className="size-3" />
      {value.toLocaleString("id-ID")} {label}
    </span>
  );
}

export function PenjualanBalokHariPanel({
  initialData,
  todayISO,
  loadDay,
}: {
  initialData: PenjualanBalokHari;
  todayISO: string;
  loadDay: (dateISO: string) => Promise<PenjualanBalokHari>;
}) {
  const [data, setData] = useState(initialData);
  const [dateISO, setDateISO] = useState(initialData.dateISO);
  const [pending, startTransition] = useTransition();

  const isToday = dateISO === todayISO;
  const canGoNext = dateISO < todayISO;
  const totalBalok = data.qtyKecil + data.qtyBesar;

  function navigate(next: string) {
    setDateISO(next);
    startTransition(async () => {
      setData(await loadDay(next));
    });
  }

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Penjualan {isToday ? "Hari Ini" : ""}
              </p>
              <GrowthBadge percent={data.growthPercent} delta={data.nominal - data.bulanLaluNominal} />
            </div>
            <p className="text-xs text-muted-foreground">
              {dayFormatter.format(new Date(`${dateISO}T00:00:00Z`))}
              {isToday && " (hari ini)"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              aria-label="Hari sebelumnya"
              disabled={pending}
              onClick={() => navigate(shiftDateISO(dateISO, -1))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              aria-label="Hari berikutnya"
              disabled={pending || !canGoNext}
              onClick={() => canGoNext && navigate(shiftDateISO(dateISO, 1))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <div className="flex items-start justify-between gap-2">
            {/* Nominal + harga rata-rata per jenis balok tepat di bawahnya;
                chip harga yang menyesuaikan lebar, chip balok tetap di kanan. */}
            <div className="flex min-w-0 flex-col items-start gap-1">
              <p className="font-display text-2xl leading-tight font-semibold tabular-nums text-primary">
                {formatRupiah(data.nominal)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span
                  title="Harga rata-rata balok kecil (termasuk ongkos logistik)"
                  className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  <Coins className="size-3" />
                  Kecil {data.hargaKecil ? formatRupiahAvg(data.hargaKecil) : "-"}
                </span>
                <span
                  title="Harga rata-rata balok besar (termasuk ongkos logistik)"
                  className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  <Coins className="size-3" />
                  Besar {data.hargaBesar ? formatRupiahAvg(data.hargaBesar) : "-"}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5">
              <Box className="size-4 text-primary" />
              <div className="flex flex-col leading-tight">
                <span className="font-display text-sm font-semibold tabular-nums text-primary">
                  {totalBalok.toLocaleString("id-ID")}
                </span>
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">balok terjual</span>
              </div>
            </div>
          </div>
          <div className="-mx-1 mt-2 overflow-x-auto px-1">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5">
              <DocChip icon={ClipboardList} label="Pesanan" value={data.dokumen} />
              <span className="justify-self-end">
                <BalokChip label="Balok Kecil" value={data.qtyKecil} />
              </span>
              <DocChip icon={Users} label="Mitra" value={data.agen} />
              <span className="justify-self-end">
                <BalokChip label="Balok Besar" value={data.qtyBesar} />
              </span>
            </div>
          </div>
          {/* Tabel VS Tanggal — gaya sama dengan "VS Periode" di panel bulan. */}
          <div className="-mx-1 mt-2 overflow-x-auto border-t px-1 pt-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Tanggal</span>
              <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Nominal
              </span>
              <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Balok
              </span>
              {data.pembanding.map((p, i) => (
                <Fragment key={p.tanggalISO}>
                  <span className="whitespace-nowrap text-xs" title={KETERANGAN_PEMBANDING[i]}>
                    {p.tanggalISO.replaceAll("-", "/")}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{compactRupiah.format(p.nominal)}</span>
                    <TrendPill percent={pctChange(data.nominal, p.nominal)} />
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">{p.qty.toLocaleString("id-ID")}</span>
                    <TrendPill percent={pctChange(totalBalok, p.qty)} />
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
