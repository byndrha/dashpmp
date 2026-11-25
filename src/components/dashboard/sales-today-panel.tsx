"use client";

import { Fragment, useState, useTransition } from "react";
import { addDays, subDays, format, parseISO } from "date-fns";
import { ChevronLeft, ChevronRight, ShoppingCart, Truck, Receipt, Wallet, Coins, Package, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocChip, TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah, formatRupiahAvg, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesToday } from "@/lib/queries/sales-overview";
import { getSalesForDayAction } from "@/app/mkesindo/(dashboard)/sales/actions";

const compactRupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Sesuai urutan SalesToday.Pembanding (lihat getSalesForDay).
const KETERANGAN_PEMBANDING = ["Kemarin", "Tanggal yang sama bulan lalu", "Tanggal yang sama tahun lalu", "Tanggal yang sama dua tahun lalu"];

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

function toISO(date: Date): string {
  return format(date, "yyyy-MM-dd");
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

export function SalesTodayPanel({
  initialData,
  initialDateISO,
  businessTodayISO,
}: {
  initialData: SalesToday;
  initialDateISO: string;
  businessTodayISO: string;
}) {
  const [dateISO, setDateISO] = useState(initialDateISO);
  const [data, setData] = useState(initialData);
  const [pending, startTransition] = useTransition();

  const isToday = dateISO === businessTodayISO;
  const canGoNext = dateISO < businessTodayISO;

  function navigate(nextDateISO: string) {
    setDateISO(nextDateISO);
    startTransition(async () => {
      const result = await getSalesForDayAction(nextDateISO);
      setData(result);
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
              <GrowthBadge percent={data.GrowthPercent} delta={data.NetSales - data.LastMonthNetSales} />
            </div>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(dateISO), "EEEE, d MMM yyyy")}
              {isToday && " (hari ini)"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={pending}
              onClick={() => navigate(toISO(subDays(parseISO(dateISO), 1)))}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={pending || !canGoNext}
              onClick={() => canGoNext && navigate(toISO(addDays(parseISO(dateISO), 1)))}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            {/* Nominal + harga rata-rata tepat di bawahnya. */}
            <div className="flex flex-col items-start gap-1">
              <p className="font-display text-2xl leading-tight font-semibold tabular-nums text-primary">
                {formatRupiah(data.NetSales)}
              </p>
              <span
                title="Harga rata-rata"
                aria-label="Harga rata-rata"
                className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
              >
                <Coins className="size-3" />
                {formatRupiahAvg(data.AvgPrice)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5">
              <Truck className="size-4 text-primary" />
              <div className="flex flex-col leading-tight">
                <span className="font-display text-sm font-semibold tabular-nums text-primary">
                  {(data.Qty10KG + data.Qty5KG).toLocaleString("id-ID")}
                </span>
                <span className="text-[10px] whitespace-nowrap text-muted-foreground">kantong terkirim</span>
              </div>
            </div>
          </div>
          {/* Horizontal-scroll safety net: the auto-sized columns don't
              wrap, so at narrower card widths (e.g. the tablet 2-up layout)
              this scrolls instead of spilling past the card edge. */}
          <div className="-mx-1 mt-2 overflow-x-auto px-1">
            <div className="grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-1.5">
              <DocChip icon={ShoppingCart} label="SO" value={data.SOCount} />
              <DocChip icon={Truck} label="DO" value={data.DOCount} />
              <span className="inline-flex items-center justify-self-end gap-1 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                <Package className="size-3" />
                {data.Qty10KG.toLocaleString("id-ID")} Kantong 10KG Terkirim
              </span>
              <DocChip icon={Receipt} label="SI" value={data.SICount} />
              <DocChip icon={Wallet} label="SP" value={data.SPCount} />
              <span className="inline-flex items-center justify-self-end gap-1 whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                <Package className="size-3" />
                {data.Qty5KG.toLocaleString("id-ID")} Kantong 5KG Terkirim
              </span>
            </div>
          </div>
          {/* Perbandingan dengan kemarin & tanggal yang sama bulan lalu,
              tahun lalu, dua tahun lalu (nominal SI & kantong terkirim DO) —
              gaya sama dengan tabel "VS Periode" di panel perbandingan bulan. */}
          <div className="-mx-1 mt-2 overflow-x-auto border-t px-1 pt-2">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Tanggal</span>
              <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Nominal
              </span>
              <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                DO Qty
              </span>
              {data.Pembanding.map((p, i) => (
                <Fragment key={p.tanggalISO}>
                  <span className="whitespace-nowrap text-xs text-foreground" title={KETERANGAN_PEMBANDING[i]}>
                    {p.tanggalISO.replaceAll("-", "/")}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {compactRupiahFormatter.format(p.NetSales)}
                    </span>
                    <TrendPill percent={pctChange(data.NetSales, p.NetSales)} />
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      {p.Qty.toLocaleString("id-ID")}
                    </span>
                    <TrendPill percent={pctChange(data.Qty10KG + data.Qty5KG, p.Qty)} />
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
