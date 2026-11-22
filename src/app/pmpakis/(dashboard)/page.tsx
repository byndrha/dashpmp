import type { Metadata } from "next";
import { requirePmpakis, canAccessAllPT } from "@/lib/require-access";
import { BerandaEsBalok } from "@/components/dashboard/beranda-es-balok";

export const metadata: Metadata = { title: "Beranda" };

export default async function PmpakisHomePage() {
  const session = await requirePmpakis();
  // Sama dengan requirePmpakisKeuangan: operator produksi tidak melihat angka keuangan.
  const bolehKeuangan = !(session.user.isProduksi && !canAccessAllPT(session.user));
  return (
    <BerandaEsBalok
      kode="pmpakis"
      nama={session.user.name ?? session.user.username ?? ""}
      bolehKeuangan={bolehKeuangan}
    />
  );
}
