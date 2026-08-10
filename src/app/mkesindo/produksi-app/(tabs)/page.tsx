import { requireProduksi } from "@/lib/require-access";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppKartuPengirimanPage() {
  const session = await requireProduksi();
  const jadwal = await getDraftJadwalForProduksi();

  return (
    <ProduksiTabShell
      initialTab="kartu-pengiriman"
      userName={session.user.name ?? session.user.username}
      initialKartuPengiriman={jadwal}
    />
  );
}
