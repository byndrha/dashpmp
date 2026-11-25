import { getPool, sql } from "@/lib/db";

// Mitra Cadangan (DashboardMitraCadangan, lihat scripts/create-mitra-cadangan-table.ts):
// mitra semu tempat menumpang stok es gratis cadangan (mis. "Complimentary")
// — BUKAN tujuan antar. Stop SO-nya dikecualikan dari rute, Validasi Rute,
// dan Aplikasi Driver (STOP_LOKASI_COLUMNS → StopIsCadangan), dan tidak
// membutuhkan titik lokasi.

export async function isMitraCadangan(businessPartnerId: string): Promise<boolean> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("bpId", sql.VarChar(16), businessPartnerId)
    .query(`SELECT 1 AS Ada FROM DashboardMitraCadangan WHERE BusinessPartnerID = @bpId`);
  return r.recordset.length > 0;
}

/**
 * Tandai / lepas Cadangan.
 * - Tandai: catat penanda + simpan pin utama lama (PinLatitudeLama/
 *   PinLongitudeLama), lalu HAPUS pin utama dan nonaktifkan lokasi
 *   pengiriman tambahan — mitra cadangan tidak punya titik lokasi.
 * - Lepas: hapus penanda, dan pulihkan pin utama lama bila mitra belum punya
 *   pin lagi (supaya tidak langsung "Tanpa lokasi" di rute).
 */
export async function setMitraCadangan(businessPartnerId: string, cadangan: boolean, akunId: number): Promise<void> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const req = () => new sql.Request(tx).input("bpId", sql.VarChar(16), businessPartnerId);
    if (cadangan) {
      await req()
        .input("akunId", sql.Int, akunId)
        .query(`
          IF NOT EXISTS (SELECT 1 FROM DashboardMitraCadangan WHERE BusinessPartnerID = @bpId)
            INSERT INTO DashboardMitraCadangan (BusinessPartnerID, PinLatitudeLama, PinLongitudeLama, DitandaiOlehAkunID)
            SELECT @bpId, ml.Latitude, ml.Longitude, @akunId
            FROM (SELECT 1 AS x) d
            LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = @bpId
        `);
      await req().query(`
        UPDATE c SET PinLatitudeLama = ml.Latitude, PinLongitudeLama = ml.Longitude
        FROM DashboardMitraCadangan c
        JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = c.BusinessPartnerID
        WHERE c.BusinessPartnerID = @bpId
      `);
      await req().query(`DELETE FROM DashboardMitraLocation WHERE BusinessPartnerID = @bpId`);
      await req().query(`
        UPDATE DashboardMitraLokasiPengiriman SET IsDeleted = 1
        WHERE BusinessPartnerID = @bpId AND ISNULL(IsDeleted, 0) = 0
      `);
    } else {
      await req()
        .input("akunIdTeks", sql.VarChar(16), String(akunId))
        .query(`
        INSERT INTO DashboardMitraLocation (BusinessPartnerID, Latitude, Longitude, CreatedByUserID)
        SELECT c.BusinessPartnerID, c.PinLatitudeLama, c.PinLongitudeLama, @akunIdTeks
        FROM DashboardMitraCadangan c
        WHERE c.BusinessPartnerID = @bpId
          AND c.PinLatitudeLama IS NOT NULL AND c.PinLongitudeLama IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM DashboardMitraLocation ml WHERE ml.BusinessPartnerID = @bpId)
      `);
      await req().query(`DELETE FROM DashboardMitraCadangan WHERE BusinessPartnerID = @bpId`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
