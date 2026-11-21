"use client";

// Padanan SalesComparisonPanel + SalesAveragesSection (Es Kristal) untuk Es
// Balok: nominal & balok terjual bulan yang dipilih, dibandingkan dengan
// bulan lalu, bulan sama tahun lalu, dan dua tahun lalu; plus rata-rata
// balok/hari dan harga jual per jenis balok (bisa dibuka-tutup).
import { Fragment, useState, useTransition } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PenjualanBalokBulan } from "@/lib/queries/penjualan-es-balok";

const compactRupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  maximumFractionDigits: 1,
});

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function monthLabel(monthISO: string): string {
  const [y, m] = monthISO.split("-").map(Number);
  return `${BULAN[m - 1]} ${y}`;
}

function shiftMonthISO(monthISO: string, delta: number): string {
  const [y, m] = monthISO.split("-").map(Number);
  const z = m - 1 + delta;
  return `${y + Math.floor(z / 12)}-${String((((z % 12) + 12) % 12) + 1).padStart(2, "0")}-01`;
}

function AverageRow({
  label,
  now,
  before,
  percent,
}: {
  label: string;
  now: string;
  before: string;
  percent: number | null;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2">
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums">{now}</span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <TrendPill percent={percent} />
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{before}</span>
    </div>
  );
}

export function PenjualanBalokBulanPanel({
  initialData,
  todayISO,
  loadMonth,
}: {
  initialData: PenjualanBalokBulan;
  todayISO: string;
  loadMonth: (monthISO: string) => Promise<PenjualanBalokBulan>;
}) {
  const [data, setData] = useState(initialData);
  const [monthISO, setMonthISO] = useState(initialData.monthISO);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const canGoNext = monthISO < todayISO.slice(0, 7) + "-01";
  const r = data.rataRata;
  const rp = (v: number) => (v ? formatRupiah(v) : "-");

  function navigate(next: string) {
    setMonthISO(next);
    startTransition(async () => {
      setData(await loadMonth(next));
    });
  }

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3 px-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {monthLabel(monthISO)}
              {data.isCurrentMonth && monthISO === data.monthISO ? " (s.d. hari ini)" : ""}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Bulan sebelumnya"
                disabled={pending}
                onClick={() => navigate(shiftMonthISO(monthISO, -1))}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                aria-label="Bulan berikutnya"
                disabled={pending || !canGoNext}
                onClick={() => canGoNext && navigate(shiftMonthISO(monthISO, 1))}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="font-display text-xl font-semibold tabular-nums">{formatRupiah(data.nominal)}</p>
              <div className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2 py-1">
                <Box className="size-3.5 text-primary" />
                <div className="flex flex-col leading-tight">
                  <span className="font-display text-xs font-semibold tabular-nums text-primary">
                    {data.qty.toLocaleString("id-ID")}
                  </span>
                  <span className="whitespace-nowrap text-[9px] text-muted-foreground">balok terjual</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={cn("-mx-1 overflow-x-auto border-t px-1 pt-3", pending && "opacity-50")}>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">VS Periode</span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Nominal
            </span>
            <span className="justify-self-end text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Balok
            </span>
            {data.perbandingan.map((c) => (
              <Fragment key={c.label}>
                <span className="whitespace-nowrap text-xs">{c.label}</span>
                <div className="flex items-center justify-end gap-1">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{compactRupiah.format(c.nominal)}</span>
                  <TrendPill percent={c.nominalPct} />
                </div>
                <div className="flex items-center justify-end gap-1">
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{c.qty.toLocaleString("id-ID")}</span>
                  <TrendPill percent={c.qtyPct} />
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="border-t pt-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Rata-rata Bulan Ini vs Bulan Lalu
            </p>
            <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="-mx-1 mt-2 overflow-x-auto px-1">
              <div className="flex min-w-max flex-col gap-1.5">
                <AverageRow
                  label="Balok Terjual / Hari"
                  now={Math.round(r.balokPerHari).toLocaleString("id-ID")}
                  before={Math.round(r.balokPerHariLalu).toLocaleString("id-ID")}
                  percent={r.balokPerHariPct}
                />
                <AverageRow label="Harga Balok Kecil" now={rp(r.hargaKecil)} before={rp(r.hargaKecilLalu)} percent={r.hargaKecilPct} />
                <AverageRow label="Harga Balok Besar" now={rp(r.hargaBesar)} before={rp(r.hargaBesarLalu)} percent={r.hargaBesarPct} />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
