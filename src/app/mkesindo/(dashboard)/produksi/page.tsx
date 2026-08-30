import type { Metadata } from "next";
import { requireProduksiView } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getSemuaAnggotaTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { PetaWarehouseDesktop } from "@/components/produksi/peta-warehouse-desktop";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { PanelTimProduksi } from "@/components/produksi/panel-tim-produksi";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";

export const metadata: Metadata = { title: "Produksi" };

export default async function ProduksiPage() {
  await requireProduksiView();
  const [posisi, mesinList, anggotaTimList, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getSemuaAnggotaTim(),
    getRiwayatProduksi(),
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
        <PanelTimProduksi anggotaList={anggotaTimList} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
        <RiwayatProduksi riwayat={riwayat} />
      </section>
    </div>
  );
}
