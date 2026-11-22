// src/components/dashboard/piutang-summary-panel.tsx
"use client";

// Bagian atas halaman Piutang Es Balok: baris judul + filter tanggal (ikut
// menempel saat digulir, lihat KELAS_HALAMAN), ringkasan posisi/pergerakan/
// umur hutang, dan tren bulanan. Data AWAL (periode bawaan & umur) diambil
// server saat render (HalamanPiutangEsBalok) — tidak ada lagi fetch saat
// mount. Server Action hanya dipanggil ketika periode diubah lewat "Terapkan";
// umur hutang adalah posisi SAAT INI, tidak bergantung periode, jadi tidak
// diambil ulang.
import { useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { RingkasanPiutangEsBalok } from "@/components/dashboard/ringkasan-piutang-es-balok";
import { TrenPiutangBulanan } from "@/components/dashboard/tren-piutang-bulanan";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";
import type { EsBalokPeriodSummary } from "@/lib/queries/piutang-invoice-outstanding";
import type { UmurPiutangBersih } from "@/lib/queries/umur-piutang-bersih";

const FORMAT_TANGGAL = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function labelPeriode(awalISO: string, akhirISO: string): string {
  return `${FORMAT_TANGGAL.format(new Date(`${awalISO}T00:00:00Z`))} – ${FORMAT_TANGGAL.format(new Date(`${akhirISO}T00:00:00Z`))}`;
}

export function PiutangSummaryPanel({
  judul,
  data,
  awalISO,
  akhirISO,
  initialPeriode,
  initialUmur,
  fetchPeriodSummary,
}: {
  judul: string;
  data: PiutangSummaryData;
  // Periode bawaan yang dipakai server untuk initialPeriode (WIB, inklusif).
  awalISO: string;
  akhirISO: string;
  initialPeriode: EsBalokPeriodSummary;
  initialUmur: UmurPiutangBersih;
  fetchPeriodSummary: (startDate: string, endDate: string) => Promise<EsBalokPeriodSummary>;
}) {
  const [startDate, setStartDate] = useState(awalISO);
  const [endDate, setEndDate] = useState(akhirISO);
  const [periode, setPeriode] = useState(initialPeriode);
  // Rentang yang benar-benar dipakai `periode` (bukan isian yang mungkin
  // sudah diubah tetapi belum diterapkan).
  const [diterapkan, setDiterapkan] = useState({ awal: awalISO, akhir: akhirISO });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterHpBuka, setFilterHpBuka] = useState(false);

  function terapkan(awal: string, akhir: string) {
    setLoading(true);
    setError(null);
    fetchPeriodSummary(awal, akhir)
      .then((p) => {
        setPeriode(p);
        setDiterapkan({ awal, akhir });
      })
      .catch(() => setError("Gagal memuat data periode ini."))
      .finally(() => setLoading(false));
  }

  // `contents`: anak-anak panel ini secara tata letak menjadi anak langsung
  // kolom halaman (HalamanPiutangEsBalok), supaya baris judul tetap
  // menempel sepanjang halaman — termasuk saat menggulir Rincian per Mitra —
  // bukan berhenti di ujung panel ringkasan.
  return (
    <div className="contents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">{judul}</h1>
        {/* HP: satu tombol Filter berisi isian tanggal — sama dengan FilterBar
            mode hanyaTombol di Es Kristal — supaya baris judul yang menempel
            tetap satu baris. */}
        <Popover open={filterHpBuka} onOpenChange={setFilterHpBuka}>
          <PopoverTrigger
            render={<Button variant="outline" size="icon" className="size-9 sm:hidden" aria-label="Filter" title="Filter" />}
          >
            <Filter className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="piutang-hp-start" className="text-xs">
                  Tanggal Awal
                </Label>
                <Input id="piutang-hp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="piutang-hp-end" className="text-xs">
                  Tanggal Akhir
                </Label>
                <Input id="piutang-hp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              <Button
                onClick={() => {
                  terapkan(startDate, endDate);
                  setFilterHpBuka(false);
                }}
                disabled={loading}
              >
                Terapkan
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <div className="hidden flex-wrap items-center gap-3 sm:flex sm:rounded-lg sm:border sm:bg-card sm:p-3">
          <Input
            id="piutang-summary-start"
            type="date"
            aria-label="Tanggal Awal"
            title="Tanggal Awal"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
          <Input
            id="piutang-summary-end"
            type="date"
            aria-label="Tanggal Akhir"
            title="Tanggal Akhir"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
          <Button onClick={() => terapkan(startDate, endDate)} disabled={loading}>
            {loading ? "Memuat..." : "Terapkan"}
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading ? (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Skeleton className="h-[150px] w-full rounded-xl" />
            <Skeleton className="h-[150px] w-full rounded-xl lg:col-span-2" />
          </div>
          <Skeleton className="h-[220px] w-full rounded-xl" />
        </>
      ) : (
        <RingkasanPiutangEsBalok
          data={data}
          periode={periode}
          umur={initialUmur}
          periodeLabel={labelPeriode(diterapkan.awal, diterapkan.akhir)}
        />
      )}

      <TrenPiutangBulanan months={data.months} bulanBerjalan={akhirISO.slice(0, 7)} />
    </div>
  );
}
