import { getPool, sql } from "@/lib/db";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";

// RoleID values from DashboardRole — already-existing roles in this
// database, not created by this feature. Marketing (1003) is who submits
// pengajuan; Supervisor (3) and Accounting (4), plus Super Admin, are who
// may approve/reject (business decision — see design spec).
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];

export type PengajuanStatus = "Menunggu" | "Disetujui" | "Ditolak";

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
