import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getCurrentShiftRows } from "@/lib/queries/stok-bahan-baku";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Bahan Baku" };

export default async function ProduksiAppBahanBakuPage() {
  const session = await requireProduksi();
  const [bahanBaku, profile] = await Promise.all([getCurrentShiftRows(), getUserById(Number(session.user.id))]);

  return (
    <ProduksiTabShell
      initialTab="bahan-baku"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialBahanBaku={bahanBaku}
    />
  );
}
