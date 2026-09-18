"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah } from "@/lib/format";
import { getKorelasiProduksiPenjualanAction } from "@/app/mkesindo/produksi/actions";
import type { KorelasiProduksiPenjualanData, KorelasiShiftRow } from "@/lib/queries/produksi-korelasi-penjualan";

// Roman-numeral shift labels matching the user's own table example (Shift
// II -> III -> I), rather than getShiftLabel's "Shift 2 (15:00)" form.
const SHIFT_ROMAN: Record<KorelasiShiftRow["shift"], string> = { 1: "I", 2: "II", 3: "III" };

// Periode jadi KOLOM, metrik jadi BARIS -- tabel aslinya (periode per baris,
// 7 metrik per kolom) meluber ke samping dan perlu scroll horizontal;
// ditranspose 2026-09-19 atas permintaan user supaya memanjang ke bawah
// saja (5 kolom -- label + 4 periode -- selalu muat di lebar kartu ini).
interface PeriodColumn {
  key: string;
  label: string;
  row: KorelasiShiftRow | null; // null untuk kolom "Stok Awal"
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function formatWaste(value: number | null): string {
  if (value == null) return "-";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

// Yesterday/tomorrow relative to a "YYYY-MM-DD" TanggalUsaha label, done via
// UTC-anchored Date math (same day-shift convention getPreviousShift in
// report-shift.ts already relies on) so this never drifts across a DST-less
// naive date string.
function shiftTanggalUsaha(tanggalUsaha: string, deltaDays: number): string {
  const d = new Date(`${tanggalUsaha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function KorelasiProduksiPenjualanPanel({ tanggalUsahaAwal }: { tanggalUsahaAwal: string }) {
  const [tanggalUsaha, setTanggalUsaha] = useState(tanggalUsahaAwal);
  const [data, setData] = useState<KorelasiProduksiPenjualanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getKorelasiProduksiPenjualanAction(tanggalUsaha).then((res) => {
      if (cancelled) return;
      if (res.success) setData(res.data);
      else setError(res.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tanggalUsaha]);

  return (
    <Card className="w-full lg:w-[440px] lg:shrink-0">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">Korelasi Produksi &ndash; Penjualan</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={loading}
              onClick={() => setTanggalUsaha((t) => shiftTanggalUsaha(t, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={loading}
              onClick={() => setTanggalUsaha((t) => shiftTanggalUsaha(t, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{formatDate(tanggalUsaha)} &middot; Shift II &rarr; III &rarr; I</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data ? (
          (() => {
            // Ringkasan satu periode penuh (jumlah ketiga shift), bukan
            // rata-rata per shift -- "Sisa (Stok)" dihitung dengan rumus
            // rekonsiliasi yang sama seperti kolom "Sisa Produksi" di tabel
            // bawah (Stok Awal + Produksi - DO - Retur - Kerusakan), hanya
            // sekali untuk seluruh periode alih-alih bertahap per shift.
            const totalProduksi = data.rows.reduce((sum, r) => sum + r.totalProduksi, 0);
            const totalDO = data.rows.reduce((sum, r) => sum + r.totalDO, 0);
            const totalRetur = data.rows.reduce((sum, r) => sum + r.retur, 0);
            const totalKerusakan = data.rows.reduce((sum, r) => sum + r.kerusakan, 0);
            const sisaStok = data.stokAwalPeriode + totalProduksi - totalDO - totalRetur - totalKerusakan;
            const penjualanPercent = totalProduksi > 0 ? (totalDO / totalProduksi) * 100 : null;
            // Literal seperti diminta user 2026-09-19: Total Produksi / Total
            // Retur x 100% -- BUKAN kebalikannya (Retur/Produksi, dipakai
            // kolom "Waste" per-shift di tabel bawah). Dua metrik berbeda,
            // jangan disamakan meski sama-sama melibatkan Retur.
            const returPercent = totalRetur > 0 ? (totalProduksi / totalRetur) * 100 : null;
            // Opsi A (dikonfirmasi user 2026-09-19): rate HPP Bersih Rp/kantong
            // BULAN ini (dari modul HPP Bersih yang sudah ada) x Produksi
            // periode ini -- estimasi, bukan biaya riil shift ini, karena HPP
            // Bersih sendiri rata-rata bulanan seluruh perusahaan (sewa,
            // listrik, gaji, dll tidak bisa dipecah per-shift secara akurat).
            const costEstimasi = data.hppBersihRatePerKantong * totalProduksi;

            const ringkasanBaris1: { label: string; value: ReactNode }[] = [
              { label: "Produksi", value: formatQty(totalProduksi) },
              { label: "Terkirim", value: formatQty(totalDO) },
              { label: "Sisa (Stok)", value: formatQty(sisaStok) },
              { label: "Retur", value: formatQty(totalRetur) },
            ];
            const ringkasanBaris2: { label: string; value: ReactNode; tooltip?: string }[] = [
              { label: "Penjualan", value: formatWaste(penjualanPercent) },
              { label: "Indeks Retur", value: formatWaste(returPercent) },
              {
                label: "Cost",
                value: formatRupiah(costEstimasi),
                tooltip: `Estimasi, bukan biaya riil periode ini: rate HPP Bersih bulan ${formatDate(tanggalUsaha)} (${formatRupiah(data.hppBersihRatePerKantong)}/kantong, dari modul HPP Bersih) × Produksi periode ini (${formatQty(totalProduksi)} kantong) = ${formatRupiah(costEstimasi)}. HPP Bersih adalah rata-rata bulanan seluruh perusahaan (sewa, listrik, gaji, dll) -- tidak bisa dipecah per-shift secara akurat.`,
              },
            ];

            const periods: PeriodColumn[] = [
              { key: "awal", label: "Stok Awal", row: null },
              ...data.rows.map((row) => ({ key: String(row.shift), label: `Shift ${SHIFT_ROMAN[row.shift]}`, row })),
            ];
            const metrics: { label: string; emphasize?: boolean; render: (p: PeriodColumn) => ReactNode }[] = [
              { label: "Produksi", render: (p) => (p.row ? formatQty(p.row.totalProduksi) : "—") },
              { label: "DO", render: (p) => (p.row ? formatQty(p.row.totalDO) : "—") },
              {
                label: "Sisa Produksi",
                emphasize: true,
                render: (p) => (p.row ? formatQty(p.row.sisaProduksi) : "—"),
              },
              {
                label: "ColdStorage",
                render: (p) =>
                  p.row ? (
                    <>
                      {formatQty(p.row.coldStorage)}
                      {!p.row.coldStorageFinal && <span className="ml-1 text-[10px] text-muted-foreground">(live)</span>}
                    </>
                  ) : (
                    formatQty(data.stokAwalPeriode)
                  ),
              },
              { label: "Return", render: (p) => (p.row ? formatQty(p.row.retur) : "—") },
              { label: "Waste", render: (p) => (p.row ? formatWaste(p.row.wastePercent) : "—") },
              { label: "Kerusakan", render: (p) => (p.row ? formatQty(p.row.kerusakan) : "—") },
            ];

            return (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                  <div className="grid grid-cols-4 gap-3">
                    {ringkasanBaris1.map((r) => (
                      <div key={r.label} className="flex flex-col gap-0.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                        <p className="text-sm font-semibold tabular-nums">{r.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3 border-t pt-3">
                    {ringkasanBaris2.map((r) => (
                      <div key={r.label} className="flex flex-col gap-0.5">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                        {r.tooltip ? (
                          <Tooltip>
                            <TooltipTrigger className="w-fit cursor-help text-left text-sm font-semibold tabular-nums underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                              {r.value}
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">{r.tooltip}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <p className="text-sm font-semibold tabular-nums">{r.value}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Metrik</TableHead>
                      {periods.map((p) => (
                        <TableHead key={p.key} className="text-right">
                          {p.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {metrics.map((m) => (
                      <TableRow key={m.label}>
                        <TableCell className="text-muted-foreground">{m.label}</TableCell>
                        {periods.map((p) => (
                          <TableCell key={p.key} className={cn("text-right tabular-nums", m.emphasize && "font-semibold")}>
                            {m.render(p)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            );
          })()
        ) : null}
      </CardContent>
    </Card>
  );
}
