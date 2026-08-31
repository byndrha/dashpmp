"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { getRingkasanLintasShiftAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { RingkasanShiftRow } from "@/lib/queries/laporan-ringkasan-lintas-shift";
import { JENIS_BARANG_LABEL } from "@/lib/stok-bahan-baku-shared";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function formatRupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function skorWarna(skor: number): string {
  if (skor === 3) return "text-emerald-600";
  if (skor === 0) return "text-destructive";
  return "text-amber-600";
}

export function LaporanRingkasanLintasShift({
  tahunAwal,
  bulanAwal,
  rowsAwal,
  namaMap,
  timNamaMap,
}: {
  tahunAwal: number;
  bulanAwal: number;
  rowsAwal: RingkasanShiftRow[];
  namaMap: Record<number, string>;
  timNamaMap: Record<number, string>;
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [rows, setRows] = useState(rowsAwal);
  const [loading, setLoading] = useState(false);
  // Index ke `rows` untuk Kartu Detail Shift -- default baris TERAKHIR
  // (shift paling baru) dari bulan yang sedang dimuat. Navigasi shift
  // yang melewati ujung bulan yang dimuat adalah no-op -- ganti bulan
  // dulu lewat navigasi Grafik Tren untuk mengakses shift di bulan lain.
  const [selectedIndex, setSelectedIndex] = useState(rowsAwal.length - 1);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows(rowsAwal);
      setSelectedIndex(rowsAwal.length - 1);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRingkasanLintasShiftAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setRows(result.data);
        setSelectedIndex(result.data.length - 1);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tahun, bulan, tahunAwal, bulanAwal, rowsAwal]);

  function gantiBulan(delta: number) {
    let nextBulan = bulan + delta;
    let nextTahun = tahun;
    if (nextBulan < 1) {
      nextBulan = 12;
      nextTahun -= 1;
    } else if (nextBulan > 12) {
      nextBulan = 1;
      nextTahun += 1;
    }
    setBulan(nextBulan);
    setTahun(nextTahun);
  }

  function gantiShift(delta: number) {
    setSelectedIndex((prev) => Math.max(0, Math.min(rows.length - 1, prev + delta)));
  }

  const selected: RingkasanShiftRow | undefined = rows[selectedIndex];

  const skorTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.skorKelengkapan }));
  const produksiTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.produksiTotalKantongEkivalen }));
  const muatanTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.muatanJumlahMuat }));
  const kasKecilTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.kasKecilSaldoAkhir }));
  const bahanBakuTrendData = rows.map((r) => ({ name: `${formatDate(r.tanggalUsaha)} S${r.shift}`, value: r.bahanBakuKantongEkivalenMasuk }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Kartu Detail Shift</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => gantiShift(-1)} disabled={selectedIndex <= 0}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => gantiShift(1)} disabled={selectedIndex >= rows.length - 1}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        {!selected ? (
          <p className="text-xs text-muted-foreground">Belum ada data bulan ini.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">
                {formatDate(selected.tanggalUsaha)} — Shift {selected.shift}
              </p>
              <p className={`text-lg font-bold ${skorWarna(selected.skorKelengkapan)}`}>{selected.skorKelengkapan}/3 lengkap</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Bahan Baku {selected.bahanBakuLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  {selected.bahanBakuPerJenis.map((b) => (
                    <div key={b.jenisBarang} className="flex justify-between">
                      <span className="text-muted-foreground">{JENIS_BARANG_LABEL[b.jenisBarang]}</span>
                      <span className="tabular-nums">
                        G:{b.sisaGudangAkhir.toLocaleString("id-ID")} / I:{b.sisaInventoriAkhir.toLocaleString("id-ID")}
                      </span>
                    </div>
                  ))}
                  {selected.bahanBakuPerJenis.length === 0 && <p className="text-muted-foreground">Belum diisi.</p>}
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Produksi {selected.produksiLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tim Bertugas</span>
                    <span>{selected.produksiTimId ? (timNamaMap[selected.produksiTimId] ?? "?") : "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Staf Operasional</span>
                    <span>{selected.produksiStafOperasionalAkunId ? (namaMap[selected.produksiStafOperasionalAkunId] ?? "?") : "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kantong Ekivalen</span>
                    <span className="tabular-nums">{selected.produksiTotalKantongEkivalen.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Denda</span>
                    <span className="tabular-nums">{formatRupiah(selected.produksiTotalDenda)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Muatan Distribusi</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Jumlah Muat</span>
                    <span className="tabular-nums">{selected.muatanJumlahMuat}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kantong Ekivalen</span>
                    <span className="tabular-nums">{selected.muatanTotalKantongEkivalen.toLocaleString("id-ID")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kendala</span>
                    <span className="tabular-nums">{selected.muatanJumlahKendala}</span>
                  </div>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kas Kecil {selected.kasKecilLengkap ? "✓" : "✗"}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kas Masuk</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilKasMasuk)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Pengeluaran</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilTotalPengeluaran)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Saldo Akhir</span>
                    <span className="tabular-nums">{formatRupiah(selected.kasKecilSaldoAkhir)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">Grafik Tren</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => gantiBulan(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="min-w-28 text-center text-sm font-medium">
              {BULAN_NAMA[bulan - 1]} {tahun}
            </p>
            <Button variant="outline" size="icon" onClick={() => gantiBulan(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">Memuat...</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Skor Kelengkapan (0-3)</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleLineChart data={skorTrendData} color="var(--chart-1)" valueFormatter={(v) => `${v}/3`} />
              </CardContent>
            </Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kantong Ekivalen Produksi</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={produksiTrendData} color="var(--chart-2)" height={160} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Jumlah Muat Distribusi</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={muatanTrendData} color="var(--chart-3)" height={160} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Saldo Akhir Kas Kecil</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={kasKecilTrendData} color="var(--chart-4)" height={160} valueFormatter={formatRupiah} />
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">Kantong Ekivalen Masuk Bahan Baku</CardTitle>
                </CardHeader>
                <CardContent>
                  <SimpleLineChart data={bahanBakuTrendData} color="var(--chart-5)" height={160} />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
