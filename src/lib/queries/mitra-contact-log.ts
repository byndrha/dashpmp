import { getPool, sql } from "@/lib/db";
import type { ContactType } from "@/lib/saluran-follow-up";

// Kolom DB ContactType = saluran follow-up ("melalui apa").
export type { ContactType };

export interface MitraContactLogEntry {
  LogID: number;
  BusinessPartnerID: string;
  LogDate: string;
  ContactType: ContactType;
  DilakukanOleh: string | null;
  HasilPenawaran: string | null;
  AngkaPemesanan: number | null;
  AlasanTidakSesuai: string | null;
  CreatedByUserID: string;
  // Waktu log dicatat (naive WIB dari GETDATE(), dikirim apa adanya sebagai
  // string ISO tanpa zona — tampilkan dengan slice, jangan dikonversi).
  DicatatPada: string;
}

// Urutan "terbaru": log lama (sebelum append-only) bisa diedit di tempat,
// jadi waktu efektifnya ModifiedAt bila ada.
const URUTAN_TERBARU = "COALESCE(ModifiedAt, CreatedAt) DESC, LogID DESC";

// Riwayat lengkap log penawaran satu mitra di satu tanggal, terbaru dulu.
// Baris pertama = yang dianggap benar. Diambil saat sel dibuka saja.
export async function getRiwayatPenawaran(businessPartnerId: string, dateISO: string): Promise<MitraContactLogEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId)
    .input("logDate", sql.Date, new Date(dateISO))
    .query(`
      SELECT LogID, BusinessPartnerID, LogDate, ContactType, DilakukanOleh, HasilPenawaran,
             AngkaPemesanan, AlasanTidakSesuai, CreatedByUserID,
             COALESCE(ModifiedAt, CreatedAt) AS DicatatPada
      FROM DashboardMitraContactLog
      WHERE BusinessPartnerID = @businessPartnerId AND LogDate = @logDate AND IsDeleted = 0
      ORDER BY ${URUTAN_TERBARU}
    `);
  return (
    result.recordset as (Omit<MitraContactLogEntry, "LogDate" | "DicatatPada"> & {
      LogDate: Date;
      DicatatPada: Date;
      AngkaPemesanan: number | string | null;
    })[]
  ).map((r) => ({
    ...r,
    AngkaPemesanan: r.AngkaPemesanan != null ? Number(r.AngkaPemesanan) : null,
    LogDate: r.LogDate.toISOString().slice(0, 10),
    DicatatPada: r.DicatatPada.toISOString().slice(0, 19),
  }));
}

export interface MitraContactLogSummaryEntry {
  BusinessPartnerID: string;
  LogDate: string;
  // null = sudah follow-up tapi log terbarunya tanpa angka pemesanan.
  AngkaPemesanan: number | null;
}

// Satu baris per (mitra, tanggal) yang punya follow-up, untuk seluruh
// rentang tampil — diambil dari log TERBARU tiap pasangan. Kalau log
// terbaru tidak menyebut angka, AngkaPemesanan null (log lama yang
// berangka tidak dipakai); pasangan tanpa baris = belum di-follow-up.
export async function getMitraContactLogSummaryForRange(
  startDateISO: string,
  endDateISO: string
): Promise<MitraContactLogSummaryEntry[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, new Date(startDateISO))
    .input("endDate", sql.Date, new Date(endDateISO)).query(`
      SELECT BusinessPartnerID, LogDate, AngkaPemesanan
      FROM (
        SELECT BusinessPartnerID, LogDate, AngkaPemesanan,
               ROW_NUMBER() OVER (PARTITION BY BusinessPartnerID, LogDate ORDER BY ${URUTAN_TERBARU}) AS Urut
        FROM DashboardMitraContactLog
        WHERE LogDate >= @startDate AND LogDate < @endDate AND IsDeleted = 0
      ) x
      WHERE Urut = 1
    `);
  return (
    result.recordset as { BusinessPartnerID: string; LogDate: Date; AngkaPemesanan: number | string | null }[]
  ).map((r) => ({
    BusinessPartnerID: r.BusinessPartnerID,
    LogDate: r.LogDate.toISOString().slice(0, 10),
    AngkaPemesanan: r.AngkaPemesanan != null ? Number(r.AngkaPemesanan) : null,
  }));
}

// Hapus-lunak satu log (khusus Accounting/Direktur — dicek di action). Log
// tetap ada di DB beserta siapa & kapan menghapus; hanya disembunyikan dari
// riwayat dan ringkasan, sehingga log sebelumnya kembali jadi "terbaru".
export async function hapusLogPenawaran(logId: number, userId: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("logId", sql.Int, logId)
    .input("userId", sql.VarChar(16), userId).query(`
      UPDATE DashboardMitraContactLog
      SET IsDeleted = 1, DihapusOlehUserID = @userId, DihapusPada = GETDATE()
      WHERE LogID = @logId AND IsDeleted = 0
    `);
  return result.rowsAffected[0] > 0;
}

// Append-only: setiap log baru = baris baru, tidak pernah mengubah log lama.
export async function tambahLogPenawaran(input: {
  businessPartnerId: string;
  dateISO: string;
  contactType: ContactType;
  dilakukanOleh: string;
  hasilPenawaran: string | null;
  angkaPemesanan: number | null;
  alasanTidakSesuai: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId)
    .input("logDate", sql.Date, new Date(input.dateISO))
    .input("contactType", sql.VarChar(10), input.contactType)
    .input("dilakukanOleh", sql.NVarChar(100), input.dilakukanOleh)
    .input("hasilPenawaran", sql.NVarChar(500), input.hasilPenawaran)
    .input("angkaPemesanan", sql.Decimal(18, 2), input.angkaPemesanan)
    .input("alasanTidakSesuai", sql.NVarChar(500), input.alasanTidakSesuai)
    .input("userId", sql.VarChar(16), input.userId).query(`
      INSERT INTO DashboardMitraContactLog
        (BusinessPartnerID, LogDate, ContactType, DilakukanOleh, HasilPenawaran, AngkaPemesanan, AlasanTidakSesuai, CreatedByUserID)
      VALUES
        (@businessPartnerId, @logDate, @contactType, @dilakukanOleh, @hasilPenawaran, @angkaPemesanan, @alasanTidakSesuai, @userId)
    `);
}
