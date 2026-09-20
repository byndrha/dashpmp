import type { Metadata } from "next";
import { requireProduksiView } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getRiwayatProduksiDetail } from "@/lib/queries/produksi-riwayat-detail";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAllTim, getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap, getProduksiAkunOptions } from "@/lib/queries/akun";
import { getJadwalBulan } from "@/lib/queries/jadwal-tim-produksi";
import { getValidasiBulanAction } from "@/app/mkesindo/produksi/actions";
import { getCurrentShift } from "@/lib/queries/aktivitas-produksi";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
import { KorelasiProduksiPenjualanPanel } from "@/components/produksi/korelasi-produksi-penjualan-panel";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { JadwalDanRiwayatProduksi } from "@/components/produksi/jadwal-dan-riwayat-produksi";
import { KoreksiSnapshotDialog } from "@/components/produksi/koreksi-snapshot-dialog";

export const metadata: Metadata = { title: "Produksi" };

export default async function ProduksiPage() {
  await requireProduksiView();
  const { tanggalUsaha } = getCurrentShift();
  const tahunAwal = Number(tanggalUsaha.slice(0, 4));
  const bulanAwal = Number(tanggalUsaha.slice(5, 7));
  const [posisi, mesinList, timList, anggotaTimList, produksiAkunOptions, riwayatGrupRaw, jadwalAwal, validasiBulanResult] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getAllTim(),
    getSemuaAnggotaTim(),
    getProduksiAkunOptions(),
    getRiwayatProduksiDetail(),
    getJadwalBulan(tahunAwal, bulanAwal),
    getValidasiBulanAction(tahunAwal, bulanAwal),
  ]);
  const validasiBulanAwal = validasiBulanResult.success ? validasiBulanResult.data : {};
  // CreatedByUserID Kualitas ada di ruang AkunID Postgres yang sama dengan
  // DicatatOlehAkunID (keduanya diisi dari session.user.id, lihat komentar
  // di produksi-riwayat-detail.ts) -- diresolusi di sini (bukan di query
  // file MSSQL-nya) karena getAkunNamaMap baca dari Postgres, DB yang beda.
  const riwayatAkunIds = riwayatGrupRaw.flatMap((g) => g.entries.map((e) => e.dicatatOlehAkunId));
  const riwayatNamaMap = await getAkunNamaMap(riwayatAkunIds);
  const riwayatGrup = riwayatGrupRaw.map((g) => ({
    ...g,
    entries: g.entries.map((e) => ({ ...e, dicatatOlehNama: riwayatNamaMap.get(e.dicatatOlehAkunId) ?? "Tidak diketahui" })),
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Grid 2-kolom (kolom kiri fleksibel, kolom kanan tetap 440px seperti
          lebar panel Korelasi). Kartu Mesin Produksi diposisikan absolute,
          "menggantung" separuh di dalam - separuh di luar tepi bawah kotak
          Peta Cold Storage -- translate-y-1/2 menggeser turun setengah
          TINGGINYA SENDIRI, sehingga titik tengahnya presis di garis tepi
          bawah kotak peta berapa pun tinggi kartunya (rentang horizontal
          Msn 3/2/1 mulai dari kiri, TIDAK sampai ke kanan). Legenda dirender
          INTERNAL oleh PetaWarehouseDesktop sendiri (bukan di sini lagi) --
          posisinya diukur dari DOM supaya selalu presis di tengah "Pintu
          Geser" berapa pun lebar layar, lihat peta-warehouse-desktop.tsx.
          mb-16 di container relatif tetap menyediakan ruang supaya separuh
          Msn yang menonjol ke bawah tidak bertabrakan dengan section
          "Jadwal Tim Produksi" di bawahnya. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_440px] lg:items-start">
        <div className="relative mb-16 min-w-0">
          <div className="mb-2 flex justify-end">
            <KoreksiSnapshotDialog />
          </div>
          <PetaWarehouseDesktop posisi={posisi} mesinList={mesinList} />
          <div className="absolute inset-x-4 bottom-0 z-10 translate-y-1/2">
            <PanelMesin mesinList={mesinList} />
          </div>
        </div>
        <KorelasiProduksiPenjualanPanel tanggalUsahaAwal={tanggalUsaha} />
      </div>
      <JadwalDanRiwayatProduksi
        tahunAwal={tahunAwal}
        bulanAwal={bulanAwal}
        jadwalAwal={jadwalAwal}
        timList={timList}
        anggotaList={anggotaTimList}
        produksiAkunOptions={produksiAkunOptions}
        tanggalUsahaHariIni={tanggalUsaha}
        riwayatGrup={riwayatGrup}
        validasiBulanAwal={validasiBulanAwal}
      />
    </div>
  );
}
