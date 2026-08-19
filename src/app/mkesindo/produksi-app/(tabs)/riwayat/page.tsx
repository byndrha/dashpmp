import { requireProduksi } from "@/lib/require-access";
import { getDraftJadwalRiwayatForProduksi } from "@/lib/queries/produksi-muatan";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppRiwayatPage() {
  const session = await requireProduksi();
  const [riwayat, profile] = await Promise.all([
    getDraftJadwalRiwayatForProduksi(),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <ProduksiTabShell
      initialTab="riwayat"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialRiwayat={riwayat}
    />
  );
}
