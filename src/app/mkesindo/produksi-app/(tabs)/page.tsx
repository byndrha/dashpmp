import { requireProduksi } from "@/lib/require-access";
import { getDraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import { getBusinessDateISO } from "@/lib/business-date";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppKartuPengirimanPage() {
  const session = await requireProduksi();
  const jadwal = await getDraftJadwalForProduksi(getBusinessDateISO());

  return (
    <ProduksiTabShell
      initialTab="kartu-pengiriman"
      userName={session.user.name ?? session.user.username}
      initialKartuPengiriman={jadwal}
    />
  );
}
