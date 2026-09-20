"use server";

import { requireManagerKeAtas } from "@/lib/require-access";
import { verifyOwnPassword, getAkunNamaMap } from "@/lib/queries/akun";
import {
  generateKodeAmbilAlih,
  getKodeAmbilAlihAktif,
  getRiwayatKodeAmbilAlih,
  type KodeAmbilAlihAktif,
  type RiwayatKodeAmbilAlihRow,
} from "@/lib/queries/kode-ambil-alih";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function generateKodeAmbilAlihAction(password: string): Promise<ActionResult<KodeAmbilAlihAktif>> {
  return runAction(async () => {
    const session = await requireManagerKeAtas();
    if (!password) throw new AppError("Isi password.");
    const ok = await verifyOwnPassword(Number(session.user.id), password);
    if (!ok) throw new AppError("Password salah.");
    return generateKodeAmbilAlih(Number(session.user.id));
  });
}

export async function getKodeAmbilAlihAktifAction(): Promise<ActionResult<KodeAmbilAlihAktif | null>> {
  return runAction(async () => {
    await requireManagerKeAtas();
    return getKodeAmbilAlihAktif();
  });
}

export interface RiwayatKodeAmbilAlihRowWithNama extends RiwayatKodeAmbilAlihRow {
  dibuatOlehNama: string;
  dipakaiOlehNama: string | null;
}

export async function getRiwayatKodeAmbilAlihAction(): Promise<ActionResult<RiwayatKodeAmbilAlihRowWithNama[]>> {
  return runAction(async () => {
    await requireManagerKeAtas();
    const rows = await getRiwayatKodeAmbilAlih();
    const akunIds = rows.flatMap((r) => (r.dipakaiOlehAkunId != null ? [r.dibuatOlehAkunId, r.dipakaiOlehAkunId] : [r.dibuatOlehAkunId]));
    const namaMap = await getAkunNamaMap(akunIds);
    return rows.map((r) => ({
      ...r,
      dibuatOlehNama: namaMap.get(r.dibuatOlehAkunId) ?? "Tidak diketahui",
      dipakaiOlehNama: r.dipakaiOlehAkunId != null ? (namaMap.get(r.dipakaiOlehAkunId) ?? "Tidak diketahui") : null,
    }));
  });
}
