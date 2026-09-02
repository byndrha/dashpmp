import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamTabShell } from "@/components/satpam-app/satpam-tab-shell";
import { getActivePatroliSesiAction, getPatroliRiwayatAction } from "@/app/mkesindo/satpam-app/actions";

export const metadata: Metadata = { title: "Inspeksi" };

export default async function SatpamInspeksiPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile, activePatroliResult, patroliRiwayatResult] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
    getActivePatroliSesiAction(),
    getPatroliRiwayatAction(),
  ]);
  const activePatroliSesi = activePatroliResult.success ? activePatroliResult.data : null;
  const patroliRiwayat = patroliRiwayatResult.success ? patroliRiwayatResult.data : [];

  return (
    <SatpamTabShell
      initialTab="inspeksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialCards={cards}
      initialTimeline={timeline}
      initialActivePatroliSesi={activePatroliSesi}
      initialPatroliRiwayat={patroliRiwayat}
    />
  );
}
