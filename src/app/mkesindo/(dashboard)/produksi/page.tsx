import type { Metadata } from "next";
import { requireProduksiView } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAllTim, getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap, getProduksiAkunOptions } from "@/lib/queries/akun";
import { getJadwalBulan } from "@/lib/queries/jadwal-tim-produksi";
import { getCurrentShift } from "@/lib/queries/aktivitas-produksi";
import { PetaWarehouseDesktop, WarehouseLegend } from "@/components/produksi/peta-warehouse-desktop";
import { KorelasiProduksiPenjualanPanel } from "@/components/produksi/korelasi-produksi-penjualan-panel";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { PanelTimProduksi } from "@/components/produksi/panel-tim-produksi";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";
import { JadwalTimBulanan } from "@/components/produksi/jadwal-tim-bulanan";

export const metadata: Metadata = { title: "Produksi" };

export default async function ProduksiPage() {
  await requireProduksiView();
  const { tanggalUsaha } = getCurrentShift();
  const tahunAwal = Number(tanggalUsaha.slice(0, 4));
  const bulanAwal = Number(tanggalUsaha.slice(5, 7));
  const [posisi, mesinList, timList, anggotaTimList, produksiAkunOptions, riwayatRaw, jadwalAwal] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getAllTim(),
    getSemuaAnggotaTim(),
    getProduksiAkunOptions(),
    getRiwayatProduksi(),
    getJadwalBulan(tahunAwal, bulanAwal),
  ]);
  const namaMap = await getAkunNamaMap(riwayatRaw.map((r) => r.DicatatOlehAkunID));
  const riwayat = riwayatRaw.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-xl font-semibold">Produksi</h1>
      {/* Grid 2-kolom (kolom kiri fleksibel, kolom kanan tetap 440px seperti
          lebar panel Korelasi) dipakai bersama oleh baris Peta Cold Storage
          dan section Mesin Produksi -- auto-flow grid menempatkan Mesin
          Produksi otomatis di baris berikutnya, kolom kiri saja, sehingga
          lebarnya presis sama dengan kotak Peta Cold Storage di atasnya
          (bukan melebar penuh seperti section biasa), sesuai permintaan
          user 2026-09-19. Kolom kanan baris ke-2 sengaja dibiarkan kosong. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_440px] lg:items-start">
        <div className="min-w-0">
          {/* justify-between (bukan center) -- rata kanan tapi tetap
              terbatas lebar kolom kotak Peta Cold Storage saja (BUKAN
              lebar penuh section yang juga mencakup panel Korelasi di
              sebelahnya), supaya ada jarak wajar dari heading tanpa
              mepet ke tengah. */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Peta Cold Storage</h2>
            <WarehouseLegend />
          </div>
          <PetaWarehouseDesktop posisi={posisi} />
        </div>
        <KorelasiProduksiPenjualanPanel tanggalUsahaAwal={tanggalUsaha} />

        <div className="min-w-0">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
          <PanelMesin mesinList={mesinList} />
        </div>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Tim Produksi</h2>
        <PanelTimProduksi timList={timList} anggotaList={anggotaTimList} produksiAkunOptions={produksiAkunOptions} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Jadwal Tim Produksi</h2>
        <JadwalTimBulanan
          tahunAwal={tahunAwal}
          bulanAwal={bulanAwal}
          jadwalAwal={jadwalAwal}
          timList={timList}
          produksiAkunOptions={produksiAkunOptions}
        />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
        <RiwayatProduksi riwayat={riwayat} />
      </section>
    </div>
  );
}
