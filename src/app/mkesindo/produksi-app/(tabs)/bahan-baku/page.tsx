import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getCurrentShiftRows, getStokBahanBakuHistory } from "@/lib/queries/stok-bahan-baku";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Bahan Baku" };

export default async function ProduksiAppBahanBakuPage() {
  const session = await requireProduksi();
  const [{ current, rows }, history, profile] = await Promise.all([
    getCurrentShiftRows(),
    getStokBahanBakuHistory(),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <ProduksiTabShell
      initialTab="bahan-baku"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialBahanBaku={{ current, rows, history }}
    />
  );
}
