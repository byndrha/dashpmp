import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const posisi = await getWarehouseMap();

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      initialWarehouse={posisi}
    />
  );
}
