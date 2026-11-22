"use client";

// Tren Pergerakan Piutang Bulanan (desain ulang 2026-11-22). DATA TIDAK
// BERUBAH — tetap data.months dari getPiutangSummary (dikonfirmasi benar
// oleh pengguna); yang baru hanya penyajiannya:
//   - grafik batang divergen 12 bulan untuk pergerakan bersih (naik = merah,
//     turun = hijau), supaya polanya terbaca sekilas;
//   - tabel dengan bulan berjalan ditandai, pembayaran sebagai pengurang,
//     rasio bayar/jual, dan chip pergerakan bersih ▲/▼.
import { useState } from "react";
import { ChevronDown, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import { Petunjuk } from "@/components/ui/petunjuk";
import { cn } from "@/lib/utils";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";

const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BARIS_RINGKAS = 4;

function labelBulan(kunci: string, pendek = false): string {
  const [tahun, bulan] = kunci.split("-");
  const nama = NAMA_BULAN[Number(bulan) - 1];
  return pendek ? nama : `${nama} ${tahun}`;
}

function jutaan(n: number): string {
  const nilai = Math.abs(n) / 1e6;
  return `${n < 0 ? "−" : ""}${nilai.toLocaleString("id-ID", { maximumFractionDigits: nilai >= 100 ? 0 : 1 })} jt`;
}

export function TrenPiutangBulanan({ months, bulanBerjalan }: { months: PiutangSummaryData["months"]; bulanBerjalan: string }) {
  const [semua, setSemua] = useState(false);
  const urutTerbaru = [...months].reverse();
  const tampil = semua ? urutTerbaru : urutTerbaru.slice(0, BARIS_RINGKAS);
  const totalBersih = months.reduce((t, m) => t + m.netMovement, 0);
  const maksAbs = Math.max(1, ...months.map((m) => Math.abs(m.netMovement)));
  const naik = totalBersih >= 0;
  // Es Kristal tidak punya tarikan tabungan — kolomnya disembunyikan.
  const adaTarikan = months.some((m) => m.piutangTarikan !== 0);

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-4 px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Tren pergerakan hutang bulanan</p>
            <p className="text-xs text-muted-foreground">
              {months.length} bulan terakhir · pergerakan bersih = penjualan − pembayaran{adaTarikan ? " + tarikan" : ""}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              naik ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
            )}
          >
            {naik ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            Hutang {naik ? "naik" : "turun"} {formatRupiah(Math.abs(totalBersih))}
          </span>
        </div>

        {/* Batang divergen: garis tengah = 0, ke atas = hutang bertambah. */}
        <div className="flex flex-col gap-1">
          <div className="relative grid h-28 grid-flow-col auto-cols-fr items-stretch gap-1.5">
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" />
            {months.map((m) => {
              const tinggi = (Math.abs(m.netMovement) / maksAbs) * 50;
              const atas = m.netMovement >= 0;
              const berjalan = m.month === bulanBerjalan;
              return (
                <Petunjuk
                  key={m.month}
                  render={<div className="group/batang relative" />}
                  judul={labelBulan(m.month)}
                  isi={`Hutang ${m.netMovement >= 0 ? "naik" : "turun"} ${formatRupiah(Math.abs(m.netMovement))} (penjualan ${formatRupiah(m.piutangBaru)}, pembayaran ${formatRupiah(m.piutangPembayaran)})`}
                >
                  <div
                    className={cn(
                      "absolute inset-x-0 mx-auto w-full max-w-7 rounded-sm transition-opacity group-hover/batang:opacity-80",
                      atas ? "bottom-1/2 bg-destructive/75" : "top-1/2 bg-primary/75",
                      berjalan && (atas ? "bg-destructive" : "bg-primary")
                    )}
                    style={{ height: `${Math.max(tinggi, m.netMovement === 0 ? 0 : 2)}%` }}
                  />
                </Petunjuk>
              );
            })}
          </div>
          <div className="grid grid-flow-col auto-cols-fr gap-1.5">
            {months.map((m) => (
              <span
                key={m.month}
                className={cn(
                  "text-center text-[10px] text-muted-foreground",
                  m.month === bulanBerjalan && "font-semibold text-foreground"
                )}
              >
                {labelBulan(m.month, true)}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Bulan</th>
                <th className="px-3 py-2 text-right font-medium">Penjualan</th>
                <th className="px-3 py-2 text-right font-medium">Pembayaran</th>
                <th className="px-3 py-2 text-right font-medium">
                  <Petunjuk
                    render={<span className="cursor-help underline decoration-dotted underline-offset-2" />}
                    judul="Pembayaran ÷ penjualan"
                    isi="Uang yang masuk bulan itu dibanding penjualan bulan itu. Di atas 100% berarti tagihan lama ikut terbayar; di bawah 100% berarti hutang bertambah. Berbeda dengan rasio hutang/omzet (total hutang ÷ penjualan)."
                  >
                    Bayar ÷ jual
                  </Petunjuk>
                </th>
                {adaTarikan && <th className="px-3 py-2 text-right font-medium">Tarikan</th>}
                <th className="px-3 py-2 text-right font-medium">Pergerakan bersih</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tampil.map((m) => {
                const berjalan = m.month === bulanBerjalan;
                const rasio = m.piutangBaru > 0 ? (m.piutangPembayaran / m.piutangBaru) * 100 : null;
                const naikBulan = m.netMovement >= 0;
                return (
                  <tr key={m.month} className={cn("transition-colors hover:bg-muted/30", berjalan && "bg-primary/5")}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium">{labelBulan(m.month)}</span>
                      {berjalan && (
                        <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          berjalan
                        </span>
                      )}
                    </td>
                    <td className="font-data px-3 py-2.5 text-right tabular-nums">{formatRupiah(m.piutangBaru)}</td>
                    <td className="font-data px-3 py-2.5 text-right tabular-nums text-primary">
                      −{formatRupiah(m.piutangPembayaran)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                      {rasio === null ? "—" : `${rasio.toLocaleString("id-ID", { maximumFractionDigits: 0 })}%`}
                    </td>
                    {adaTarikan && (
                      <td className="font-data px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {m.piutangTarikan ? `+${formatRupiah(m.piutangTarikan)}` : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={cn(
                          "font-data inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
                          naikBulan ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                        )}
                      >
                        {naikBulan ? "▲" : "▼"} {jutaan(Math.abs(m.netMovement))}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {urutTerbaru.length > BARIS_RINGKAS && (
          <button
            type="button"
            onClick={() => setSemua((v) => !v)}
            className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {semua ? "Ringkas" : `Tampilkan ${urutTerbaru.length - BARIS_RINGKAS} bulan lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", semua && "rotate-180")} />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
