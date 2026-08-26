import type { Metadata } from "next";
import { requireProduksi } from "@/lib/require-access";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export const metadata: Metadata = { title: "Pengiriman" };

export default async function ProduksiAppKartuPengirimanPage() {
  const session = await requireProduksi();
  const [jadwal, profile] = await Promise.all([getDraftJadwalForProduksi(), getUserById(Number(session.user.id))]);

  return (
    <ProduksiTabShell
      initialTab="kartu-pengiriman"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialKartuPengiriman={jadwal}
    />
  );
}
