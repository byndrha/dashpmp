"use client";

import { useState } from "react";
import { formatDate } from "@/lib/format";
import { JadwalTimBulanan } from "@/components/produksi/jadwal-tim-bulanan";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow, AnggotaTimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { RiwayatShiftGroup } from "@/lib/queries/produksi-riwayat-detail";

// Menggabungkan Jadwal Tim Produksi + Riwayat Produksi dalam satu client
// component supaya keduanya bisa berbagi state filter tanggal -- klik kotak
// tanggal di kalender menyaring Riwayat Produksi ke tanggal itu saja, klik
// tanggal yang sama lagi mengembalikannya (lihat handleTanggalClick).
// page.tsx (Server Component) tidak bisa memegang state ini sendiri, jadi
// dipindah ke sini. Sesuai permintaan user 2026-09-19.
export function JadwalDanRiwayatProduksi({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
  anggotaList,
  produksiAkunOptions,
  tanggalUsahaHariIni,
  riwayatGrup,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
  anggotaList: AnggotaTimRow[];
  produksiAkunOptions: StafOperasionalOption[];
  tanggalUsahaHariIni: string;
  riwayatGrup: RiwayatShiftGroup[];
}) {
  const [tanggalFilter, setTanggalFilter] = useState<string | null>(null);

  function handleTanggalClick(tanggalUsaha: string) {
    setTanggalFilter((prev) => (prev === tanggalUsaha ? null : tanggalUsaha));
  }

  const riwayatTertampil = tanggalFilter ? riwayatGrup.filter((g) => g.tanggalUsaha === tanggalFilter) : riwayatGrup;

  return (
    <>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Jadwal Tim Produksi</h2>
        <JadwalTimBulanan
          tahunAwal={tahunAwal}
          bulanAwal={bulanAwal}
          jadwalAwal={jadwalAwal}
          timList={timList}
          anggotaList={anggotaList}
          produksiAkunOptions={produksiAkunOptions}
          tanggalUsahaHariIni={tanggalUsahaHariIni}
          tanggalTerpilih={tanggalFilter}
          onTanggalClick={handleTanggalClick}
        />
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
          {tanggalFilter && (
            <button
              type="button"
              onClick={() => setTanggalFilter(null)}
              className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-medium text-violet-600 hover:bg-violet-500/25"
            >
              Difilter: {formatDate(tanggalFilter)} &times; klik untuk reset
            </button>
          )}
        </div>
        <RiwayatProduksi riwayatGrup={riwayatTertampil} />
      </section>
    </>
  );
}
