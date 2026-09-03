import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getWarehouseMap } from "@/lib/queries/produksi-warehouse";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { getTakeAwayMuatanPending } from "@/lib/queries/takeaway-muatan";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Stok Es" };

export default async function ProduksiAppWarehousePage() {
  const session = await requireProduksi();
  const [posisi, mesinList, profile, takeAwayPending, jadwal] = await Promise.all([
    getWarehouseMap(),
    getMesinList(),
    getUserById(Number(session.user.id)),
    getTakeAwayMuatanPending(),
    getDraftJadwalForProduksi(),
  ]);

  return (
    <ProduksiTabShell
      initialTab="warehouse"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialWarehouse={posisi}
      initialMesin={mesinList}
      initialTakeAwayPending={takeAwayPending}
      initialWarehouseJadwal={jadwal}
    />
  );
}
