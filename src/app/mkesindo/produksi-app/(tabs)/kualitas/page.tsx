import { requireProduksi } from "@/lib/require-access";
import { getKualitasRiwayat } from "@/lib/queries/produksi-kualitas";
import { getMesinList } from "@/lib/queries/produksi-mesin";
import { getUserById } from "@/lib/queries/akun";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppKualitasPage() {
  const session = await requireProduksi();
  const [kualitas, mesinList, profile] = await Promise.all([
    getKualitasRiwayat(),
    getMesinList(),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <ProduksiTabShell
      initialTab="kualitas"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialKualitas={kualitas}
      initialMesin={mesinList}
    />
  );
}
