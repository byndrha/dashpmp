import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  await requireSatpam();
  const cards = await getSatpamInspectionList(getBusinessDateISO());
  return <SatpamBerandaClient cards={cards} />;
}
