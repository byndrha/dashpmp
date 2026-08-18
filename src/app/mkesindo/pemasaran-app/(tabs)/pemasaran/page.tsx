import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { PemasaranAppTabShell } from "@/components/pemasaran-app/pemasaran-app-tab-shell";
import { BerandaTab } from "@/components/pemasaran-app/beranda-tab";
import { MitraTab } from "@/components/pemasaran-app/mitra-tab";
import { PemasaranTab } from "@/components/pemasaran-app/pemasaran-tab";

export default async function PemasaranAppPemasaranPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));
  return (
    <PemasaranAppTabShell
      initialTab="pemasaran"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      beranda={<BerandaTab />}
      mitra={<MitraTab />}
      pemasaran={<PemasaranTab />}
    />
  );
}
