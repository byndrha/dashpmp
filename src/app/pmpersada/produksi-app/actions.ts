"use server";

import { revalidatePath } from "next/cache";
import { requirePmpersadaProduksi } from "@/lib/require-access";
import {
  getBakList,
  getRekMap,
  isiAirBaru,
  setBabonan,
  setMaintenance,
  getAuditLog,
  type BakRow,
  type RekMapRow,
  type AuditLogRow,
} from "@/lib/queries/produksi-bak-pmpersada";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

export async function getBakListProduksiAppAction(): Promise<ActionResult<BakRow[]>> {
  return runAction(async () => {
    await requirePmpersadaProduksi();
    return getBakList();
  });
}

export async function getRekMapProduksiAppAction(): Promise<ActionResult<RekMapRow[]>> {
  return runAction(async () => {
    await requirePmpersadaProduksi();
    return getRekMap();
  });
}

export async function isiAirBaruProduksiAppAction(input: { rekId: number; jenisEs: "BK" | "BB"; jumlahCan: number }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    if (input.jumlahCan <= 0) throw new AppError("Jumlah Can harus lebih dari 0.");
    await isiAirBaru(input.rekId, input.jenisEs, input.jumlahCan, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setBabonanProduksiAppAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    await setBabonan(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

export async function setMaintenanceProduksiAppAction(rekId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    await setMaintenance(rekId, Number(session.user.id));
    revalidatePath("/pmpersada/produksi-app");
    revalidatePath("/pmpersada/produksi");
  });
}

// Riwayat milik operator yang login saja (bukan seluruh log semua orang —
// itu tab Rekap & Log Audit yang cuma ada di dashboard desktop Admin).
export async function getRiwayatSayaProduksiAppAction(): Promise<ActionResult<AuditLogRow[]>> {
  return runAction(async () => {
    const session = await requirePmpersadaProduksi();
    return getAuditLog(Number(session.user.id));
  });
}
