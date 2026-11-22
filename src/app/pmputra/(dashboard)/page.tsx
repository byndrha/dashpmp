import type { Metadata } from "next";
import { requirePmputra, canAccessAllPT } from "@/lib/require-access";
import { BerandaEsBalok } from "@/components/dashboard/beranda-es-balok";

export const metadata: Metadata = { title: "Beranda" };

export default async function PmputraHomePage() {
  const session = await requirePmputra();
  // Sama dengan requirePmputraKeuangan: operator produksi tidak melihat angka keuangan.
  const bolehKeuangan = !(session.user.isProduksi && !canAccessAllPT(session.user));
  return (
    <BerandaEsBalok
      kode="pmputra"
      nama={session.user.name ?? session.user.username ?? ""}
      bolehKeuangan={bolehKeuangan}
    />
  );
}
