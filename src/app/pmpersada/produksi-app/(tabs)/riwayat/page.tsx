import type { Metadata } from "next";
import { requirePmpersadaProduksi } from "@/lib/require-access";
import { getAuditLog } from "@/lib/queries/produksi-bak-pmpersada";
import { ProduksiAppTabShell } from "@/components/produksi-pmpersada-app/produksi-app-tab-shell";

export const metadata: Metadata = { title: "Riwayat" };

export default async function ProduksiAppRiwayatPage() {
  const session = await requirePmpersadaProduksi();
  const riwayat = await getAuditLog(Number(session.user.id));
  return <ProduksiAppTabShell initialTab="riwayat" userName={session.user.name ?? session.user.username} initialRiwayat={riwayat} />;
}
