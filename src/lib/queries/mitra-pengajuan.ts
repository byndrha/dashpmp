import { getPool, sql } from "@/lib/db";
import { getPgPool } from "@/lib/pg";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { createMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";
import { createSalesOrderFromPengajuan } from "@/lib/queries/sales-order";
import { MARKETING_ROLE_ID, APPROVER_ROLE_IDS } from "@/lib/roles";
import { AGEN_QTY_THRESHOLD, RPA_QTY_THRESHOLD } from "@/lib/mitra-classification";
import { AppError } from "@/lib/action-result";

// qty <= AGEN_QTY_THRESHOLD -> Outlet (Gender "Female"), AGEN_QTY_THRESHOLD <
// qty <= RPA_QTY_THRESHOLD -> Agen (Gender "Male"), qty > RPA_QTY_THRESHOLD
// -> RPA (Gender "Other") — see PARTNER_TYPE_CASE in aging.ts for the
// Gender->PartnerType mapping this feeds into. Thresholds live in
// lib/mitra-classification.ts (a plain, DB-import-free module) rather than
// here, so pengajuan-sub-tab.tsx's client-side classifyPartnerType() can
// import them directly without pulling this file's server-only mssql/pg
// code into the client bundle — re-exported below for server-side callers
// that already import other constants from this file.
export { AGEN_QTY_THRESHOLD, RPA_QTY_THRESHOLD };

export { MARKETING_ROLE_ID, APPROVER_ROLE_IDS };

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
  Keterangan: string | null;
  ConvertedBusinessPartnerID: string | null;
  CreatedAt: string;
}

// MarketingUserID -> nama can't be joined in one SQL statement since
// DashboardMitraPengajuan (MSSQL) and akun (Postgres) are different
// database engines — resolved here in application code instead. Same
// pattern as getMarketingWilayahAssignments/getMarketingMitraAssignments
// in marketing-wilayah.ts.
export async function getPengajuanList(): Promise<PengajuanRow[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const result = await mssqlPool.request().query(`
    SELECT
        dmp.PengajuanID,
        dmp.MarketingUserID,
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
        dmp.Keterangan,
        dmp.ConvertedBusinessPartnerID,
        dmp.CreatedAt
    FROM DashboardMitraPengajuan dmp
    ORDER BY dmp.CreatedAt DESC
  `);
  const rows = result.recordset as Omit<PengajuanRow, "MarketingNama">[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  return rows.map((r) => ({ ...r, MarketingNama: nameMap.get(Number(r.MarketingUserID)) ?? "Tidak diketahui" }));
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
//
// Active Marketing users come from Postgres (akun/peran); the visit/convert
// counts come from MSSQL DashboardMitraPengajuan, keyed on the same
// MarketingUserID = akun.id values migrate-marketing-userid-to-akun-id.ts
// established — aggregated per user in application code since the two
// tables live in different database engines.
export async function getMarketingKPI(): Promise<MarketingKPIRow[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const businessToday = getBusinessDate();
  const monthStart = monthBoundary(businessToday);
  const monthEnd = monthBoundary(businessToday, 1);

  const usersResult = await pgPool.query(
    `SELECT id, nama FROM akun WHERE peran_id = $1 AND is_active = true ORDER BY nama`,
    [MARKETING_ROLE_ID]
  );
  const users = usersResult.rows as { id: number; nama: string }[];

  const pengajuanResult = await mssqlPool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .input("monthEnd", sql.Date, monthEnd).query(`
      SELECT MarketingUserID, QtyKantong
      FROM DashboardMitraPengajuan
      WHERE CreatedAt >= @monthStart AND CreatedAt < @monthEnd
    `);
  const pengajuanRows = pengajuanResult.recordset as { MarketingUserID: string; QtyKantong: number | null }[];

  return users.map((u) => {
    const own = pengajuanRows.filter((p) => Number(p.MarketingUserID) === u.id);
    return {
      UserID: String(u.id),
      Nama: u.nama,
      Kunjungan: own.length,
      Konversi: own.filter((p) => (p.QtyKantong ?? 0) > 0).length,
    };
  });
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
    .input("waktu", sql.DateTime, input.waktuPermintaanSampai ? parseWibDateTimeLocal(input.waktuPermintaanSampai) : null)
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

export async function approvePengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  keterangan?: string | null
): Promise<void> {
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
             inserted.Kapasitas, inserted.Kompetitor, inserted.QtyKantong, inserted.WaktuPermintaanSampai
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
        QtyKantong: number | null;
        WaktuPermintaanSampai: Date | null;
      }
    | undefined;
  if (!row) throw new AppError("Pengajuan tidak ditemukan atau sudah diproses");

  try {
    // Reuses the exact mitra-creation path the Mitra module's own "Tambah
    // Mitra" form uses — same Code/BusinessPartnerID generation, same
    // required-column defaults (see mitra.ts createMitra()).
    const mitraInput: MitraInput = {
      name: row.NamaCalon,
      mobileNo: row.NoHP,
      address: row.Alamat,
      wilayah: row.Wilayah,
      kecamatan: row.Kecamatan,
      gender:
        row.QtyKantong != null && row.QtyKantong > RPA_QTY_THRESHOLD
          ? "Other"
          : row.QtyKantong != null && row.QtyKantong > AGEN_QTY_THRESHOLD
            ? "Male"
            : "Female",
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

    // A Pengajuan with no captured Qty has nothing to order yet — approving
    // it still creates the Mitra above, just without a Sales Order.
    if (row.QtyKantong != null && row.QtyKantong > 0) {
      await createSalesOrderFromPengajuan({
        businessPartnerId,
        address: row.Alamat,
        qtyKantong: row.QtyKantong,
        priceLevel: row.PriceLevel,
        dueDate: row.WaktuPermintaanSampai,
      });
    }

    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("reviewer", sql.VarChar(16), reviewerUserId)
      .input("keterangan", sql.VarChar(500), keterangan ?? null).query(`
        UPDATE DashboardMitraPengajuan
        SET Status = 'Disetujui', ConvertedBusinessPartnerID = @bpId,
            ReviewedByUserID = @reviewer, ReviewedAt = GETDATE(), Keterangan = @keterangan
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
  keterangan: string | null
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("reviewer", sql.VarChar(16), reviewerUserId)
    .input("keterangan", sql.VarChar(500), keterangan).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Ditolak', Keterangan = @keterangan,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);
}

// Hard delete — this only removes the pengajuan log entry, never the
// BusinessPartner it may have already been converted into (that's a
// separate, independently-stored record via ConvertedBusinessPartnerID;
// deleting this row has no effect on it). Restricted to Super Admin only,
// enforced in the server action, not here.
export async function deletePengajuan(pengajuanId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .query(`DELETE FROM DashboardMitraPengajuan WHERE PengajuanID = @id`);
}
