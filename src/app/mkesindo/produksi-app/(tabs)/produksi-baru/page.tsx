import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppProduksiBaruPage() {
  const session = await requireProduksi();
  const [posisi, mesinList] = await Promise.all([getWarehouseMap(), getMesinList()]);

  return (
    <ProduksiTabShell
      initialTab="produksi-baru"
      userName={session.user.name ?? session.user.username}
      initialWarehouse={posisi}
      initialMesin={mesinList}
    />
  );
}
