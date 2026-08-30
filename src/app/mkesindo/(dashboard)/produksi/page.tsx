import type { Metadata } from "next";
import { requireProduksiView } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAllTim, getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap, getProduksiAkunOptions } from "@/lib/queries/akun";
import { getJadwalBulan } from "@/lib/queries/jadwal-tim-produksi";
import { getCurrentShift } from "@/lib/queries/aktivitas-produksi";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
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
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Peta Warehouse</h2>
        <PetaWarehouseDesktop posisi={posisi} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
        <PanelMesin mesinList={mesinList} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Tim Produksi</h2>
        <PanelTimProduksi timList={timList} anggotaList={anggotaTimList} produksiAkunOptions={produksiAkunOptions} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Jadwal Tim Produksi</h2>
        <JadwalTimBulanan tahunAwal={tahunAwal} bulanAwal={bulanAwal} jadwalAwal={jadwalAwal} timList={timList} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
        <RiwayatProduksi riwayat={riwayat} />
      </section>
    </div>
  );
}
