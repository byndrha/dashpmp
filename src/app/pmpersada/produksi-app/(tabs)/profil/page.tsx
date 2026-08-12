import { requirePmpersadaProduksi } from "@/lib/require-access";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export default async function ProduksiAppProfilPage() {
  const session = await requirePmpersadaProduksi();
  return <ProduksiAppTabShell initialTab="profil" userName={session.user.name ?? session.user.username} />;
}
