import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  const session = await requireSatpam();
  const [cards, profile] = await Promise.all([
    getSatpamInspectionList(getBusinessDateISO()),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamBerandaClient
      cards={cards}
      userName={session.user.name ?? session.user.username}
      profile={profile}
    />
  );
}
