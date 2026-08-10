import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamBerandaClient
      cards={cards}
      timeline={timeline}
      userName={session.user.name ?? session.user.username}
      profile={profile}
    />
  );
}
