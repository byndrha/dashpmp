"use server";

import { auth } from "@/lib/auth";
import {
  getDeliveryCardsForOrders,
  getSalesOrderCards,
  getSalesOrderCardsMitraHarian,
  type DeliveryCard,
  type SalesOrderCard,
} from "@/lib/queries/sales-cards";
import {
  getRiwayatPenawaran,
  hapusLogPenawaran,
  tambahLogPenawaran,
  type ContactType,
  type MitraContactLogEntry,
} from "@/lib/queries/mitra-contact-log";
import { SALURAN_FOLLOW_UP } from "@/lib/saluran-follow-up";
import { listPelakuFollowUp, type PelakuFollowUp } from "@/lib/queries/akun";
import { currentEskristalKode } from "@/lib/tenant-request";
import { canAccessAllPT } from "@/lib/require-access";
import { ACCOUNTING_ROLE_IDS } from "@/lib/roles";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// Hapus log penawaran hanya untuk Direktur (termasuk superadmin) dan Accounting.
function bolehHapusLog(user: { isSuperAdmin: boolean; accountScope: string; roleId: number }): boolean {
  return canAccessAllPT(user) || ACCOUNTING_ROLE_IDS.includes(user.roleId);
}

export async function getDeliveryCardsAction(salesOrderIds: string[]): Promise<DeliveryCard[]> {
  return getDeliveryCardsForOrders(salesOrderIds);
}

// Transaksi (SO → DO → SI/SP) satu mitra pada satu tanggal — popover angka
// tanggal di panel Transaksi DO per Mitra.
export async function getTransaksiMitraHarianAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<SalesOrderCard[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new AppError("Tanggal tidak valid");
    return getSalesOrderCardsMitraHarian(businessPartnerId, dateISO);
  });
}

// Data ekspor "Kartu Transaksi" (dulu panel sendiri) — diambil hanya saat
// tombol ekspor diklik, bukan setiap halaman dibuka.
export async function getKartuTransaksiEksporAction(filter: {
  startDate: string;
  endDate: string;
  wilayah?: string;
}): Promise<ActionResult<SalesOrderCard[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");
    return getSalesOrderCards({ startDate: filter.startDate, endDate: filter.endDate, wilayah: filter.wilayah });
  });
}

const TANGGAL_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Riwayat log hasil penawaran satu mitra di satu tanggal (terbaru dulu),
// plus apakah akun ini boleh menghapus log — dikirim bersama supaya hak
// hapus tidak perlu dioper dari halaman ke tiap sel.
export async function getRiwayatPenawaranAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<{ log: MitraContactLogEntry[]; bolehHapus: boolean; pelaku: PelakuFollowUp[] }>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");
    if (!TANGGAL_ISO.test(dateISO)) throw new AppError("Tanggal tidak valid");
    const [log, pelaku] = await Promise.all([
      getRiwayatPenawaran(businessPartnerId, dateISO),
      currentEskristalKode().then(listPelakuFollowUp),
    ]);
    return { log, bolehHapus: bolehHapusLog(session.user), pelaku };
  });
}

export async function hapusLogPenawaranAction(logId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");
    if (!bolehHapusLog(session.user)) throw new AppError("Hanya Accounting dan Direktur yang boleh menghapus log.");
    if (!Number.isInteger(logId) || logId <= 0) throw new AppError("Log tidak valid.");
    const terhapus = await hapusLogPenawaran(logId, session.user.id);
    if (!terhapus) throw new AppError("Log tidak ditemukan atau sudah dihapus.");
  });
}

// Tambah log baru — log lama tidak pernah diubah; yang terbaru dianggap benar.
export async function tambahLogPenawaranAction(input: {
  businessPartnerId: string;
  dateISO: string;
  contactType: ContactType;
  dilakukanOleh: string;
  hasilPenawaran: string | null;
  angkaPemesanan: number | null;
  alasanTidakSesuai: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");
    if (!TANGGAL_ISO.test(input.dateISO)) throw new AppError("Tanggal tidak valid");
    if (!SALURAN_FOLLOW_UP.includes(input.contactType)) throw new AppError("Pilih follow-up melalui apa.");
    const oleh = input.dilakukanOleh.trim();
    if (!oleh) throw new AppError("Pilih siapa yang melakukan follow-up.");
    if (input.angkaPemesanan != null && (!Number.isFinite(input.angkaPemesanan) || input.angkaPemesanan < 0)) {
      throw new AppError("Angka pemesanan harus angka positif.");
    }
    if (!input.hasilPenawaran && input.angkaPemesanan == null) {
      throw new AppError("Isi hasil penawaran atau angka pemesanan.");
    }
    await tambahLogPenawaran({ ...input, dilakukanOleh: oleh.slice(0, 100), userId });
  });
}
