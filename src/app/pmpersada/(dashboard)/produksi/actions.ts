"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersada } from "@/lib/require-access";
import { canAccessAllPT } from "@/lib/require-access";
import {
  getBakList,
  getRekMap,
  getKonfigurasi,
  isiAirBaru,
  setBabonan,
  setMaintenance,
  overrideTahap,
  koreksiBatch,
  updateKonfigurasi,
  getRiwayatBatch,
  getAuditLog,
  type BakRow,
  type RekMapRow,
  type KonfigurasiRow,
  type BatchRow,
  type AuditLogRow,
} from "@/lib/queries/produksi-bak-pmpersada";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// "Admin" di modul ini = siapa pun yang lolos requirePmpersada() (akun
// dashboard penuh /pmpersada) — bukan akun is_produksi-only. Dipakai untuk
// menolak aksi Admin-only kalau suatu saat sesi is_produksi ikut memanggil
// action ini secara langsung (di luar UI yang sudah membatasi tombolnya).
function assertAdmin(session: Awaited<ReturnType<typeof requirePmpersada>>) {
  if (session.user.isProduksi && !canAccessAllPT(session.user)) {
    throw new AppError("Hanya Admin yang boleh melakukan aksi ini.");
  }
}

export async function getBakListAction(): Promise<ActionResult<BakRow[]>> {
  return runAction(async () => {
    await requirePmpersada();
    return getBakList();
  });
}

export interface RekMapRowWithNama extends RekMapRow {
  DicatatOlehNama: string | null;
}

export async function getRekMapAction(): Promise<ActionResult<RekMapRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getRekMap();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID).filter((id): id is number => id != null));
    return rows.map((r) => ({ ...r, DicatatOlehNama: r.DicatatOlehAkunID != null ? (namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui") : null }));
  });
}

export async function getKonfigurasiAction(): Promise<ActionResult<KonfigurasiRow>> {
  return runAction(async () => {
    await requirePmpersada();
    return getKonfigurasi();
  });
}

export async function isiAirBaruAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await isiAirBaru(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setBabonanAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setBabonan(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setMaintenanceAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    await setMaintenance(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function overrideTahapAction(rekId: number, tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI"): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    await overrideTahap(rekId, tahap, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function koreksiBatchAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await koreksiBatch(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export async function updateKonfigurasiAction(durasiBKJam: number, durasiBBJam: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersada();
    assertAdmin(session);
    if (durasiBKJam <= 0 || durasiBBJam <= 0) throw new AppError("Durasi harus lebih dari 0 jam.");
    await updateKonfigurasi(durasiBKJam, durasiBBJam, Number(session.user.id));
    revalidatePath("/pmpersada/produksi");
  });
}

export interface BatchRowWithNama extends BatchRow {
  DicatatOlehNama: string;
}

export async function getRiwayatBatchAction(): Promise<ActionResult<BatchRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getRiwayatBatch();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}

export interface AuditLogRowWithNama extends AuditLogRow {
  DicatatOlehNama: string;
}

export async function getAuditLogAction(): Promise<ActionResult<AuditLogRowWithNama[]>> {
  return runAction(async () => {
    await requirePmpersada();
    const rows = await getAuditLog();
    const namaMap = await getAkunNamaMap(rows.map((r) => r.DicatatOlehAkunID));
    return rows.map((r) => ({ ...r, DicatatOlehNama: namaMap.get(r.DicatatOlehAkunID) ?? "Tidak diketahui" }));
  });
}
