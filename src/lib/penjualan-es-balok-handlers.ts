// Logika bersama untuk server action modul Penjualan Es Balok. Tiap halaman
// PT (pmputra/pmpersada/pmpakis) punya actions.ts sendiri yang memanggil
// guard aksesnya lalu meneruskan ke sini — file ini sengaja BUKAN "use
// server", supaya `kode` tidak pernah bisa dipilih bebas dari klien.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  getPenjualanBalokHari,
  getPenjualanBalokBulan,
  getTargetBalok,
  setTargetBalok,
  type PenjualanBalokHari,
  type PenjualanBalokBulan,
} from "@/lib/queries/penjualan-es-balok";
import type { RevenueTarget } from "@/lib/queries/revenue-target";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateISO(value: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new AppError("Tanggal tidak valid");
  }
  return value;
}

export function loadHariBalok(kode: string, dateISO: string): Promise<PenjualanBalokHari> {
  return getPenjualanBalokHari(kode, assertDateISO(dateISO));
}

export function loadBulanBalok(kode: string, monthISO: string): Promise<PenjualanBalokBulan> {
  return getPenjualanBalokBulan(kode, assertDateISO(monthISO));
}

export function loadTargetBalok(kode: string, monthISO: string): Promise<RevenueTarget> {
  const [y, m] = assertDateISO(monthISO).split("-").map(Number);
  return getTargetBalok(kode, y, m);
}

export function saveTargetBalok(
  kode: string,
  path: string,
  input: { year: number; month: number; targetNominal: number; targetQty: number }
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");
    const { year, month, targetNominal, targetQty } = input;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new AppError("Bulan tidak valid");
    }
    if (!Number.isFinite(targetNominal) || targetNominal < 0 || !Number.isFinite(targetQty) || targetQty < 0) {
      throw new AppError("Target harus angka 0 atau lebih");
    }
    await setTargetBalok(kode, { year, month, targetNominal, targetQty, userId: String(userId) });
    revalidatePath(path);
  });
}
