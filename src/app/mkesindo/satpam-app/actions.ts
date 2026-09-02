"use server";

import { revalidatePath } from "next/cache";
import { requireSatpam } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  PATROLI_TITIK_LIST,
  getActivePatroliSesi,
  getPatroliRiwayat,
  createPatroliSesi,
  addPatroliFoto,
  selesaiPatroliSesi,
  type PatroliSesiDetail,
  type PatroliSesiRingkas,
} from "@/lib/queries/satpam-patroli";
import { getSatpamOnDutyNowAction } from "@/app/mkesindo/(dashboard)/keamanan/actions";
import {
  getTamuDiDalam,
  getTamuRiwayat,
  getTamuById,
  createTamuMasuk,
  recordTamuKeluar,
  type TamuKunjunganRow,
} from "@/lib/queries/satpam-tamu";

export async function startPatroliSesiAction(): Promise<ActionResult<{ sesiId: number }>> {
  return runAction(async () => {
    const session = await requireSatpam();
    const akunId = Number(session.user.id);

    const existing = await getActivePatroliSesi(akunId);
    if (existing) {
      throw new AppError("Anda sudah punya sesi Patroli yang sedang berjalan.");
    }

    const onDutyResult = await getSatpamOnDutyNowAction();
    const onDutyRow = onDutyResult.success ? onDutyResult.data.find((r) => r.satpamAkunId === akunId) : undefined;

    const sesiId = await createPatroliSesi({
      satpamAkunId: akunId,
      shiftType: onDutyRow?.shiftType ?? null,
      tanggalUsahaShift: onDutyRow?.tanggalUsaha ?? null,
    });
    revalidatePath("/mkesindo/satpam-app/patroli");
    return { sesiId };
  });
}

export async function getActivePatroliSesiAction(): Promise<ActionResult<PatroliSesiDetail | null>> {
  return runAction(async () => {
    const session = await requireSatpam();
    return getActivePatroliSesi(Number(session.user.id));
  });
}

export async function getPatroliRiwayatAction(): Promise<ActionResult<PatroliSesiRingkas[]>> {
  return runAction(async () => {
    const session = await requireSatpam();
    return getPatroliRiwayat(Number(session.user.id));
  });
}

export async function addPatroliFotoAction(input: {
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireSatpam();
    const sesi = await getActivePatroliSesi(Number(session.user.id));
    if (!sesi || sesi.sesiId !== input.sesiId) {
      throw new AppError("Sesi Patroli tidak ditemukan atau sudah selesai.");
    }
    if (input.titikPatroli === null && !input.keterangan?.trim()) {
      throw new AppError("Foto Tambahan wajib diberi keterangan.");
    }
    await addPatroliFoto(input);
    revalidatePath("/mkesindo/satpam-app/patroli");
  });
}

export async function selesaiPatroliSesiAction(sesiId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireSatpam();
    const sesi = await getActivePatroliSesi(Number(session.user.id));
    if (!sesi || sesi.sesiId !== sesiId) {
      throw new AppError("Sesi Patroli tidak ditemukan atau sudah selesai.");
    }
    const titikTerisi = new Set(sesi.fotos.map((f) => f.titikPatroli).filter((t): t is string => t !== null));
    const belumLengkap = PATROLI_TITIK_LIST.filter((t) => !titikTerisi.has(t));
    if (belumLengkap.length > 0) {
      throw new AppError(`Masih ada ${belumLengkap.length} titik yang belum difoto: ${belumLengkap.join(", ")}.`);
    }
    await selesaiPatroliSesi(sesiId);
    revalidatePath("/mkesindo/satpam-app/patroli");
  });
}

export async function createTamuMasukAction(input: {
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<{ kunjunganId: number }>> {
  return runAction(async () => {
    await requireSatpam();
    const namaTamu = input.namaTamu.trim();
    const tujuanKunjungan = input.tujuanKunjungan.trim();
    const dikunjungi = input.dikunjungi.trim();
    if (!namaTamu || !tujuanKunjungan || !dikunjungi) {
      throw new AppError("Nama Tamu, Tujuan Kunjungan, dan Dikunjungi wajib diisi.");
    }
    const kunjunganId = await createTamuMasuk({
      namaTamu,
      asalInstansi: input.asalInstansi?.trim() || null,
      tujuanKunjungan,
      dikunjungi,
      nomorKendaraan: input.nomorKendaraan?.trim() || null,
      fotoMasukPath: input.fotoPath,
      latitude: input.latitude,
      longitude: input.longitude,
    });
    revalidatePath("/mkesindo/satpam-app/tamu");
    return { kunjunganId };
  });
}

export async function getTamuDiDalamAction(): Promise<ActionResult<TamuKunjunganRow[]>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuDiDalam();
  });
}

export async function getTamuRiwayatAction(): Promise<ActionResult<TamuKunjunganRow[]>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuRiwayat();
  });
}

export async function getTamuByIdAction(kunjunganId: number): Promise<ActionResult<TamuKunjunganRow | null>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuById(kunjunganId);
  });
}

export async function recordTamuKeluarAction(input: {
  kunjunganId: number;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireSatpam();
    await recordTamuKeluar(input.kunjunganId, input.fotoPath, input.latitude, input.longitude);
    revalidatePath("/mkesindo/satpam-app/tamu");
  });
}
