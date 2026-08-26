import type { Metadata } from "next";
import { requireMarketing } from "@/lib/require-access";
import { PemasaranAppTabShell } from "@/components/pemasaran-app/pemasaran-app-tab-shell";
import { BerandaTab } from "@/components/pemasaran-app/beranda-tab";
import { MitraTab } from "@/components/pemasaran-app/mitra-tab";
import { PemasaranTab } from "@/components/pemasaran-app/pemasaran-tab";

export const metadata: Metadata = { title: "Beranda" };

export default async function PemasaranAppBerandaPage() {
  const session = await requireMarketing();
  return (
    <PemasaranAppTabShell
      initialTab="beranda"
      userName={session.user.name ?? session.user.username}
      beranda={<BerandaTab />}
      mitra={<MitraTab />}
      pemasaran={<PemasaranTab />}
    />
  );
}
