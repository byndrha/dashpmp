import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Stok Es" };

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList, profile] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialWarehouse={posisi}
      initialMesin={mesinList}
    />
  );
}
