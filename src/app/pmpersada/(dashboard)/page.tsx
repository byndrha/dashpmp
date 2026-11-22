import type { Metadata } from "next";
import { requirePmpersada, canAccessAllPT } from "@/lib/require-access";
import { BerandaEsBalok } from "@/components/dashboard/beranda-es-balok";

export const metadata: Metadata = { title: "Beranda" };

export default async function PmpersadaHomePage() {
  const session = await requirePmpersada();
  // Sama dengan requirePmpersadaKeuangan: operator produksi tidak melihat angka keuangan.
  const bolehKeuangan = !(session.user.isProduksi && !canAccessAllPT(session.user));
  return (
    <BerandaEsBalok
      kode="pmpersada"
      nama={session.user.name ?? session.user.username ?? ""}
      bolehKeuangan={bolehKeuangan}
    />
  );
}
