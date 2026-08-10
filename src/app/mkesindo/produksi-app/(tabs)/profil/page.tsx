import { requireProduksi } from "@/lib/require-access";
import { ProduksiTabShell } from "@/components/produksi-app/produksi-tab-shell";

export default async function ProduksiAppProfilPage() {
  const session = await requireProduksi();
  return <ProduksiTabShell initialTab="profil" userName={session.user.name ?? session.user.username} />;
}
