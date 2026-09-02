import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamTabShell } from "@/components/satpam-app/satpam-tab-shell";
import {
  getActivePatroliSesiAction,
  getPatroliRiwayatAction,
  getTamuDiDalamAction,
  getTamuRiwayatAction,
} from "@/app/mkesindo/satpam-app/actions";

export const metadata: Metadata = { title: "Patroli" };

export default async function SatpamPatroliPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile, activePatroliResult, patroliRiwayatResult, tamuDiDalamResult, tamuRiwayatResult] =
    await Promise.all([
      getSatpamInspectionList(businessDateISO),
      getSatpamTimeline(businessDateISO),
      getUserById(Number(session.user.id)),
      getActivePatroliSesiAction(),
      getPatroliRiwayatAction(),
      getTamuDiDalamAction(),
      getTamuRiwayatAction(),
    ]);
  const activePatroliSesi = activePatroliResult.success ? activePatroliResult.data : null;
  const patroliRiwayat = patroliRiwayatResult.success ? patroliRiwayatResult.data : [];
  const tamuDiDalam = tamuDiDalamResult.success ? tamuDiDalamResult.data : [];
  const tamuRiwayat = tamuRiwayatResult.success ? tamuRiwayatResult.data : [];

  return (
    <SatpamTabShell
      initialTab="patroli"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialCards={cards}
      initialTimeline={timeline}
      initialActivePatroliSesi={activePatroliSesi}
      initialPatroliRiwayat={patroliRiwayat}
      initialTamuDiDalam={tamuDiDalam}
      initialTamuRiwayat={tamuRiwayat}
    />
  );
}
