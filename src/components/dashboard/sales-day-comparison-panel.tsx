"use client";

import { Fragment, useState } from "react";
import { Truck, ChevronRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah, formatDayMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesDayComparison, SalesDayPoint, HourlyPoint } from "@/lib/queries/sales-overview";

// Shorter than formatRupiah() — needed so a value + trend pill still fit on
// one line inside this panel's narrow columns, same approach as
// sales-comparison-panel.tsx.
const compactRupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function pctChange(current: number, previous: number): number | null {
  return previous ? ((current - previous) / previous) * 100 : null;
}

// Expanded per-period detail: that date's own 24 WIB hours, hour-by-hour
// against today's same hour so far — hours after `currentWibHour` haven't
// happened yet today, shown as "-" rather than a misleading 0.
function HourlyComparisonTable({
  periodHourly,
  todayHourly,
  currentWibHour,
}: {
  periodHourly: HourlyPoint[];
  todayHourly: HourlyPoint[];
  currentWibHour: number;
}) {
  return (
    <div className="col-span-3 -mx-1 mt-1 mb-2 max-h-64 overflow-y-auto rounded-md border bg-secondary/20 px-2 py-2">
      <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Jam</span>
        <Tooltip>
          <TooltipTrigger className="cursor-help justify-self-end text-[9px] font-medium uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2">
            Periode Ini
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Rincian per jam berdasarkan tanggal kalender asli periode pembanding ini.
          </TooltipContent>
        </Tooltip>
        <span />
        <Tooltip>
          <TooltipTrigger className="cursor-help justify-self-end text-[9px] font-medium uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2">
            Hari Ini
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Rincian per jam berdasarkan tanggal kalender label periode saat ini — bisa kosong sepanjang sore/malam
            karena label sudah berpindah ke besok setelah rollover 14:00 WIB.
          </TooltipContent>
        </Tooltip>
        {periodHourly.map((h) => {
          const todayPoint = todayHourly[h.hour];
          const isPast = h.hour <= currentWibHour;
          const pct = isPast && todayPoint ? pctChange(todayPoint.NetSales, h.NetSales) : null;
          return (
            <Fragment key={h.hour}>
              <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                {String(h.hour).padStart(2, "0")}:00
              </span>
              <span className="justify-self-end whitespace-nowrap text-[10px] tabular-nums">
                {compactRupiahFormatter.format(h.NetSales)}{" "}
                <span className="text-muted-foreground">&middot; {h.DOQty.toLocaleString("id-ID")}</span>
              </span>
              <TrendPill percent={pct} />
              <span className="justify-self-end whitespace-nowrap text-[10px] tabular-nums">
                {isPast && todayPoint ? (
                  <>
                    {compactRupiahFormatter.format(todayPoint.NetSales)}{" "}
                    <span className="text-muted-foreground">&middot; {todayPoint.DOQty.toLocaleString("id-ID")}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Belum terjadi</span>
                )}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Quick-glance line shown even while a period's row is still collapsed —
// a cumulative "so far since the 14:00 WIB rollover" total (nominal +
// kantong), not a single-hour bucket: `previousCumulative` is that period's
// own rollover window capped at the same WIB wall-clock instant as
// `currentCumulative` (the still-in-progress current period), so the two
// sides are apples-to-apples. The other 23 individual hours stay inside
// HourlyComparisonTable until the row is actually expanded.
function CurrentHourPreview({
  previousCumulative,
  currentCumulative,
  currentWibHour,
}: {
  previousCumulative: SalesDayPoint | null;
  currentCumulative: SalesDayPoint;
  currentWibHour: number;
}) {
  if (!previousCumulative) return null;
  const pct = pctChange(currentCumulative.NetSales, previousCumulative.NetSales);
  return (
    <div className="col-span-3 -mt-0.5 mb-1 flex flex-wrap items-center gap-1.5 pl-4 text-[9px] text-muted-foreground">
      <Tooltip>
        <TooltipTrigger className="cursor-help whitespace-nowrap underline decoration-dotted underline-offset-2">
          ~ Jam {String(currentWibHour).padStart(2, "0")}:00
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          Akumulasi real-time sejak rollover 14:00 WIB terakhir sampai jam sekarang, dibandingkan periode ini pada
          rentang jam yang sama persis (apple-to-apple) — beda dari kolom Nominal/Kantong di atas yang memakai total
          1 hari penuh.
        </TooltipContent>
      </Tooltip>
      <span className="tabular-nums">
        {compactRupiahFormatter.format(previousCumulative.NetSales)}{" "}
        <span>&middot; {previousCumulative.DOQty.toLocaleString("id-ID")} kantong</span>
      </span>
      <span>vs</span>
      <span className="tabular-nums text-foreground">
        {compactRupiahFormatter.format(currentCumulative.NetSales)}{" "}
        <span>&middot; {currentCumulative.DOQty.toLocaleString("id-ID")} kantong</span>
      </span>
      <TrendPill percent={pct} />
    </div>
  );
}

// Day-level counterpart to the Penjualan module's SalesComparisonPanel (which
// compares whole months) — same "VS Periode" table layout, but rows are
// Kemarin/Pekan Lalu/Bulan Lalu/Tahun Lalu instead of prior months. "Pekan
// Lalu" can be unavailable (previous: null) when H-7 crosses into the
// previous month; that row renders "-" with no trend pill instead of a
// cross-month comparison. Each row expands (click the date) into a full
// 24-hour WIB breakdown compared against today's same hours so far.
export function SalesDayComparisonPanel({
  comparisons,
  todayHourly,
  currentWibHour,
  currentCumulative,
}: {
  comparisons: SalesDayComparison[];
  todayHourly: HourlyPoint[];
  currentWibHour: number;
  currentCumulative: SalesDayPoint;
}) {
  const current = comparisons[0]?.current;
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="py-4">
      <CardHeader className="px-4">
        <div className="flex items-center gap-1.5">
          <CardTitle className="font-display">Perbandingan Penjualan</CardTitle>
          <Tooltip>
            <TooltipTrigger className="text-muted-foreground hover:text-foreground">
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Semua periode di panel ini mengikuti rollover 14:00 WIB, bukan pukul 00:00 — setelah jam 14:00,
              transaksi baru dicatat di bawah label &quot;besok&quot;. Karena itu &quot;Hari Ini&quot; bisa tampak
              kosong di sore/malam hari, sementara baris &quot;~ Jam&quot; di tiap periode tetap menunjukkan
              progres real-time hari kalender yang sebenarnya.
            </TooltipContent>
          </Tooltip>
        </div>
        <CardDescription>Penjualan hari ini dibandingkan beberapa periode sebelumnya.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <Tooltip>
            <TooltipTrigger className="cursor-help text-xs font-medium uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2">
              Hari Ini
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Total 1 hari kalender penuh untuk label periode saat ini (bisa sudah berpindah ke tanggal besok jika
              sekarang sudah lewat jam 14:00 WIB) — bukan angka real-time. Untuk progres saat ini, lihat baris
              &quot;~ Jam&quot; di tiap periode pembanding di bawah.
            </TooltipContent>
          </Tooltip>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="font-display text-xl font-semibold tabular-nums">{formatRupiah(current?.NetSales ?? 0)}</p>
            <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2 py-1">
              <Truck className="size-3.5 text-primary" />
              <div className="flex flex-col leading-tight">
                <span className="font-display text-xs font-semibold tabular-nums text-primary">
                  {(current?.DOQty ?? 0).toLocaleString("id-ID")}
                </span>
                <Tooltip>
                  <TooltipTrigger className="cursor-help whitespace-nowrap text-left text-[9px] text-muted-foreground underline decoration-dotted underline-offset-2">
                    kantong terkirim
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64">
                    Total kantong DO terkirim untuk periode kalender yang sama dengan Rp di sebelah kiri.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {/* Horizontal-scroll safety net, mirroring sales-comparison-panel.tsx. */}
        <div className="-mx-1 overflow-x-auto border-t px-1 pt-3">
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Periode</span>
            <Tooltip>
              <TooltipTrigger className="cursor-help justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2">
                Nominal
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Total penjualan 1 hari kalender penuh tanggal pembanding, dibandingkan total &quot;Hari Ini&quot; di
                atas.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger className="cursor-help justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2">
                Kantong
              </TooltipTrigger>
              <TooltipContent className="max-w-64">Total kantong DO 1 hari kalender penuh tanggal pembanding.</TooltipContent>
            </Tooltip>
            {comparisons.map((c) => {
              const isOpen = expanded === c.label;
              return (
                <Fragment key={c.label}>
                  <button
                    type="button"
                    onClick={() => c.hourly && setExpanded(isOpen ? null : c.label)}
                    disabled={!c.hourly}
                    className={cn(
                      "flex items-center gap-1 whitespace-nowrap text-left text-xs tabular-nums text-foreground",
                      c.hourly && "hover:text-primary"
                    )}
                  >
                    {c.hourly && (
                      <ChevronRight className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-90")} />
                    )}
                    {formatDayMonth(c.dateISO)} <span className="text-muted-foreground">({c.label})</span>
                  </button>
                  {c.previous ? (
                    <>
                      <div className="flex items-center justify-end gap-1">
                        <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                          {compactRupiahFormatter.format(c.previous.NetSales)}
                        </span>
                        <TrendPill percent={c.NominalPctChange} />
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                          {c.previous.DOQty.toLocaleString("id-ID")}
                        </span>
                        <TrendPill percent={c.QtyPctChange} />
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="justify-self-end text-[10px] text-muted-foreground">-</span>
                      <span className="justify-self-end text-[10px] text-muted-foreground">-</span>
                    </>
                  )}
                  {!isOpen && (
                    <CurrentHourPreview
                      previousCumulative={c.previousCumulative}
                      currentCumulative={currentCumulative}
                      currentWibHour={currentWibHour}
                    />
                  )}
                  {isOpen && c.hourly && (
                    <HourlyComparisonTable
                      periodHourly={c.hourly}
                      todayHourly={todayHourly}
                      currentWibHour={currentWibHour}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
