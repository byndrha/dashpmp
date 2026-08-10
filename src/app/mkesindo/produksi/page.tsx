import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap, getRiwayatProduksi } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { ProduksiHeader } from "@/components/produksi/produksi-header";
import { PetaWarehouse } from "@/components/produksi/peta-warehouse";
import { PanelMesin } from "@/components/produksi/panel-mesin";
import { RiwayatProduksi } from "@/components/produksi/riwayat-produksi";

export default async function ProduksiPage() {
  const session = await requireProduksi();
  const [posisi, mesinList, riwayatRaw] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getRiwayatProduksi(),
  ]);
  const namaMap = await getAkunNamaMap(riwayatRaw.map((r) => r.DicatatOlehAkunID));
  const riwayat = riwayatRaw.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ProduksiHeader userName={session.user.name ?? session.user.username} />
      <main className="flex flex-1 flex-col gap-6 p-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Peta Warehouse</h2>
          <PetaWarehouse posisi={posisi} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Mesin Produksi</h2>
          <PanelMesin mesinList={mesinList} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Produksi</h2>
          <RiwayatProduksi riwayat={riwayat} />
        </section>
      </main>
    </div>
  );
}
