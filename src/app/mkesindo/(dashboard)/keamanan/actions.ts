"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireSatpamRosterManager } from "@/lib/require-access";
import {
  getSatpamJadwalJagaList,
  getSatpamOnDutyNowRows,
  addSatpamJadwalJaga,
  removeSatpamJadwalJaga,
  type SatpamJadwalDisplayRow,
} from "@/lib/queries/satpam-jadwal-jaga";
import type { SatpamShiftType } from "@/lib/satpam-shift";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getSatpamJadwalJagaListAction(
  startDateISO: string,
  endDateISO: string
): Promise<ActionResult<SatpamJadwalDisplayRow[]>> {
  return runAction(async () => {
    await requireSatpamRosterManager();
    return getSatpamJadwalJagaList(new Date(startDateISO), new Date(endDateISO));
  });
}

export async function addSatpamJadwalJagaAction(input: {
  tanggalUsaha: string;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
  catatan?: string;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireSatpamRosterManager();
    await addSatpamJadwalJaga({
      tanggalUsaha: new Date(input.tanggalUsaha),
      shiftType: input.shiftType,
      satpamAkunId: input.satpamAkunId,
      catatan: input.catatan?.trim() || null,
      createdByAkunId: Number(session.user.id),
    });
    revalidatePath("/mkesindo/keamanan");
  });
}

export async function removeSatpamJadwalJagaAction(jadwalJagaId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireSatpamRosterManager();
    await removeSatpamJadwalJaga(jadwalJagaId);
    revalidatePath("/mkesindo/keamanan");
  });
}

// Tidak digate requireSatpamRosterManager -- ini akan dipanggil dari
// satpam-app (sub-proyek berikutnya) oleh satpam biasa, bukan cuma
// Supervisor. Hanya butuh sesi login yang valid. `now` sengaja TIDAK
// diberikan ke getSatpamOnDutyNowRows -- biarkan default-nya sendiri
// (getNaiveWibNow()) yang jalan, jangan pernah oper `new Date()` di sini.
export async function getSatpamOnDutyNowAction(): Promise<ActionResult<SatpamJadwalDisplayRow[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user) throw new AppError("Unauthorized");
    return getSatpamOnDutyNowRows();
  });
}
