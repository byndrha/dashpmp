import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { createMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";

// A plain HTML <input type="datetime-local"> value ("2026-07-25T14:30") has
// no timezone info. This app's users are all in WIB (UTC+7) — parsing that
// string with `new Date(...)` directly would interpret it in the SERVER's
// local timezone instead (commonly UTC on a Coolify container), silently
// shifting the time by 7 hours. Convert explicitly, the same way every
// other WIB-sensitive date in this codebase is built (see business-date.ts).
function parseWibDateTimeLocal(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}

// RoleID values from DashboardRole — already-existing roles in this
// database, not created by this feature. Marketing (1003) is who submits
// pengajuan; Supervisor (3) and Accounting (4), plus Super Admin, are who
// may approve/reject (business decision — see design spec).
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];

export type PengajuanStatus = "Menunggu" | "Diproses" | "Disetujui" | "Ditolak";

export interface PengajuanRow {
  PengajuanID: number;
  MarketingUserID: string;
  MarketingNama: string;
  NamaCalon: string;
  NoHP: string | null;
  WaktuPermintaanSampai: string | null;
  QtyKantong: number | null;
  PriceLevel: number | null;
  Wilayah: string | null;
  Kecamatan: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
  Kapasitas: number | null;
  Kompetitor: string | null;
  Status: PengajuanStatus;
  CatatanTolak: string | null;
  ConvertedBusinessPartnerID: string | null;
  CreatedAt: string;
}

export async function getPengajuanList(): Promise<PengajuanRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
        dmp.PengajuanID,
        dmp.MarketingUserID,
        ISNULL(du.Nama, 'Tidak diketahui') AS MarketingNama,
        dmp.NamaCalon,
        dmp.NoHP,
        dmp.WaktuPermintaanSampai,
        dmp.QtyKantong,
        dmp.PriceLevel,
        dmp.Wilayah,
        dmp.Kecamatan,
        dmp.Alamat,
        dmp.Latitude,
        dmp.Longitude,
        dmp.Kapasitas,
        dmp.Kompetitor,
        dmp.Status,
        dmp.CatatanTolak,
        dmp.ConvertedBusinessPartnerID,
        dmp.CreatedAt
    FROM DashboardMitraPengajuan dmp
    LEFT JOIN DashboardUser du ON du.UserID = TRY_CAST(dmp.MarketingUserID AS INT)
    ORDER BY dmp.CreatedAt DESC
  `);
  return result.recordset;
}

export interface MarketingKPIRow {
  UserID: string;
  Nama: string;
  Kunjungan: number;
  Konversi: number;
}

// "Kunjungan" and "Konversi" are both scoped to the WIB business month
// (same monthBoundary() convention as every other monthly metric in this
// app — see revenue-target.ts, sales-overview.ts). Every active Marketing
// user is included even with zero pengajuan this month, so management can
// see who hasn't logged any visits yet, not just who has.
export async function getMarketingKPI(): Promise<MarketingKPIRow[]> {
  const pool = await getPool();
  const businessToday = getBusinessDate();
  const monthStart = monthBoundary(businessToday);
  const monthEnd = monthBoundary(businessToday, 1);

  const result = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .input("monthEnd", sql.Date, monthEnd)
    .input("roleId", sql.Int, MARKETING_ROLE_ID).query(`
      SELECT
          CAST(du.UserID AS VARCHAR(16)) AS UserID,
          du.Nama,
          COUNT(dmp.PengajuanID) AS Kunjungan,
          SUM(CASE WHEN dmp.QtyKantong > 0 THEN 1 ELSE 0 END) AS Konversi
      FROM DashboardUser du
      LEFT JOIN DashboardMitraPengajuan dmp
             ON dmp.MarketingUserID = CAST(du.UserID AS VARCHAR(16))
            AND dmp.CreatedAt >= @monthStart AND dmp.CreatedAt < @monthEnd
      WHERE du.RoleID = @roleId AND ISNULL(du.IsActive, 0) = 1
      GROUP BY du.UserID, du.Nama
      ORDER BY du.Nama
    `);

  return (
    result.recordset as { UserID: string; Nama: string; Kunjungan: number; Konversi: number | null }[]
  ).map((r) => ({ UserID: r.UserID, Nama: r.Nama, Kunjungan: r.Kunjungan, Konversi: r.Konversi ?? 0 }));
}

export interface PengajuanInput {
  namaCalon: string;
  noHP: string | null;
  waktuPermintaanSampai: string;
  qtyKantong: number | null;
  priceLevel: number | null;
  wilayah: string | null;
  kecamatan: string | null;
  alamat: string | null;
  latitude: number | null;
  longitude: number | null;
  kapasitas: number | null;
  kompetitor: string | null;
}

export async function createPengajuan(input: PengajuanInput, marketingUserId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("marketingUserId", sql.VarChar(16), marketingUserId)
    .input("namaCalon", sql.VarChar(128), input.namaCalon)
    .input("noHP", sql.VarChar(50), input.noHP)
    .input("waktu", sql.DateTime, parseWibDateTimeLocal(input.waktuPermintaanSampai))
    .input("qty", sql.Decimal(23, 4), input.qtyKantong)
    .input("priceLevel", sql.Int, input.priceLevel)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("alamat", sql.VarChar(1024), input.alamat)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("kapasitas", sql.Decimal(23, 4), input.kapasitas)
    .input("kompetitor", sql.VarChar(1024), input.kompetitor).query(`
      INSERT INTO DashboardMitraPengajuan
        (MarketingUserID, NamaCalon, NoHP, WaktuPermintaanSampai, QtyKantong, PriceLevel,
         Wilayah, Kecamatan, Alamat, Latitude, Longitude, Kapasitas, Kompetitor, Status, CreatedAt)
      VALUES
        (@marketingUserId, @namaCalon, @noHP, @waktu, @qty, @priceLevel,
         @wilayah, @kecamatan, @alamat, @lat, @lng, @kapasitas, @kompetitor, 'Menunggu', GETDATE())
    `);
}

export async function approvePengajuan(pengajuanId: number, reviewerUserId: string): Promise<void> {
  const pool = await getPool();

  // Atomically claim the row before doing any create-mitra work: an UPDATE
  // (not a plain SELECT) is the only way to guarantee that, under concurrent
  // double-click calls for the same pengajuanId, at most one caller can ever
  // see the row transition out of 'Menunggu'. Losing callers get an empty
  // OUTPUT and bail out before creating anything.
  const claimResult = await pool
    .request()
    .input("id", sql.Int, pengajuanId).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Diproses'
      OUTPUT inserted.NamaCalon, inserted.NoHP, inserted.Alamat, inserted.Wilayah,
             inserted.Kecamatan, inserted.PriceLevel, inserted.Latitude, inserted.Longitude,
             inserted.Kapasitas, inserted.Kompetitor
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);

  const row = claimResult.recordset[0] as
    | {
        NamaCalon: string;
        NoHP: string | null;
        Alamat: string | null;
        Wilayah: string | null;
        Kecamatan: string | null;
        PriceLevel: number | null;
        Latitude: number | null;
        Longitude: number | null;
        Kapasitas: number | null;
        Kompetitor: string | null;
      }
    | undefined;
  if (!row) throw new Error("Pengajuan tidak ditemukan atau sudah diproses");

  try {
    // Reuses the exact mitra-creation path the Mitra module's own "Tambah
    // Mitra" form uses — same Code/BusinessPartnerID generation, same
    // required-column defaults (see mitra.ts createMitra()), no duplicated
    // logic. Defaults Tipe Mitra to Retail ("Female") since this KPI is
    // specifically about retail outlets — correctable afterwards via the
    // Mitra module if a submission turns out to be an Agen.
    const mitraInput: MitraInput = {
      name: row.NamaCalon,
      mobileNo: row.NoHP,
      address: row.Alamat,
      wilayah: row.Wilayah,
      kecamatan: row.Kecamatan,
      gender: "Female",
      priceLevel: row.PriceLevel,
      termOfPaymentId: null,
      capacity: row.Kapasitas,
    };
    const businessPartnerId = await createMitra(mitraInput);

    if (row.Latitude != null && row.Longitude != null) {
      await setMitraLocation({
        businessPartnerId,
        latitude: row.Latitude,
        longitude: row.Longitude,
        alamat: row.Alamat,
        userId: reviewerUserId,
      });
    }

    if (row.Kompetitor != null && row.Kompetitor.trim() !== "") {
      await setMitraCompetitor({ businessPartnerId, kompetitor: row.Kompetitor, userId: reviewerUserId });
    }

    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("reviewer", sql.VarChar(16), reviewerUserId).query(`
        UPDATE DashboardMitraPengajuan
        SET Status = 'Disetujui', ConvertedBusinessPartnerID = @bpId,
            ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
        WHERE PengajuanID = @id AND Status = 'Diproses'
      `);
  } catch (err) {
    // Don't leave the row permanently stuck in 'Diproses' limbo if the
    // create-mitra/set-location work fails partway through — revert the
    // claim so the submission can be seen as pending / re-approved.
    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .query(`UPDATE DashboardMitraPengajuan SET Status = 'Menunggu' WHERE PengajuanID = @id AND Status = 'Diproses'`);
    throw err;
  }
}

export async function rejectPengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  catatan: string | null
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("reviewer", sql.VarChar(16), reviewerUserId)
    .input("catatan", sql.VarChar(512), catatan).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Ditolak', CatatanTolak = @catatan,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);
}
