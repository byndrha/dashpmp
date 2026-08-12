import { requirePmpersadaProduksi } from "@/lib/require-access";
import { getBakList, getRekMap } from "@/lib/queries/produksi-bak-pmpersada";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export default async function ProduksiAppDenahPage() {
  const session = await requirePmpersadaProduksi();
  const [bak, rek] = await Promise.all([getBakList(), getRekMap()]);
  return <ProduksiAppTabShell initialTab="denah" userName={session.user.name ?? session.user.username} initialBak={bak} initialRek={rek} />;
}
