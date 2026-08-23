import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export async function reportTerkendala(jadwalDetailId: number, salesmanId: string, alasan: string): Promise<void> {
  const pool = await getPool();

  // Idempotent: a double-tap (or retry after a dropped connection) must
  // not create two unresolved rows for the same stop — that would also
  // make getDriverJadwalStops()'s LEFT JOIN return duplicate base rows.
  // An existing unresolved report just gets its Alasan updated instead of
  // a second INSERT; UrutanOverride is deliberately left untouched on this
  // path so a driver's own earlier ▲▼ adjustment isn't silently undone by
  // re-reporting.
  const existing = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .query(`SELECT TerkendalaID FROM DashboardPengirimanTerkendala WHERE JadwalDetailID = @id AND IsResolved = 0`);
  if (existing.recordset[0]) {
    await pool
      .request()
      .input("terkendalaId", sql.Int, (existing.recordset[0] as { TerkendalaID: number }).TerkendalaID)
      .input("alasan", sql.VarChar(200), alasan)
      .query(`UPDATE DashboardPengirimanTerkendala SET Alasan = @alasan WHERE TerkendalaID = @terkendalaId`);
    return;
  }

  // Push to last among this stop's OWN Jadwal's remaining (not-yet-delivered)
  // stops — MAX(effective order) + 1, where "effective order" already
  // accounts for any prior UrutanOverride so repeated Terkendala reports
  // (e.g. after being reordered back up once) still land at the true end.
  const maxResult = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId).query(`
      SELECT MAX(ISNULL(other.UrutanOverride, other.Urutan)) AS MaxOrder
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwalDetail other ON other.JadwalID = jd.JadwalID AND other.IsDeleted = 0
      LEFT JOIN DashboardPengirimanStopDelivery sd ON sd.JadwalDetailID = other.JadwalDetailID
      WHERE jd.JadwalDetailID = @id AND sd.JamSelesai IS NULL
    `);
  const maxOrder = (maxResult.recordset[0] as { MaxOrder: number | null })?.MaxOrder ?? 0;

  await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("alasan", sql.VarChar(200), alasan)
    .input("urutan", sql.Int, maxOrder + 1).query(`
      INSERT INTO DashboardPengirimanTerkendala (JadwalDetailID, SalesmanID, Alasan)
      VALUES (@id, @salesmanId, @alasan);
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @urutan WHERE JadwalDetailID = @id;
    `);
}

// remainingDetailIdsInOrder: the caller's OWN current effective order
// (UrutanOverride ?? Urutan) for every not-yet-delivered stop, exactly as
// stop-flow.tsx already computes it for display — swapping two adjacent
// UrutanOverride values here, rather than recomputing order server-side,
// keeps this function a pure "swap with my neighbor" operation matching
// what a single ▲▼ tap means.
export async function moveTerkendalaStop(
  jadwalDetailId: number,
  salesmanId: string,
  direction: "up" | "down",
  remainingDetailIdsInOrder: number[]
): Promise<void> {
  const index = remainingDetailIdsInOrder.indexOf(jadwalDetailId);
  if (index === -1) throw new AppError("Tujuan ini tidak ditemukan pada daftar tersisa.");
  const swapWithIndex = direction === "up" ? index - 1 : index + 1;
  if (swapWithIndex < 0 || swapWithIndex >= remainingDetailIdsInOrder.length) {
    throw new AppError("Tujuan ini sudah berada di posisi paling ujung.");
  }
  const otherDetailId = remainingDetailIdsInOrder[swapWithIndex];

  const pool = await getPool();
  const ownershipCheck = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      SELECT COUNT(*) AS Cnt
      FROM DashboardPengirimanJadwalDetail jd
      JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
      WHERE jd.JadwalDetailID IN (@id, @otherId) AND j.SalesmanID = @salesmanId AND j.IsDeleted = 0
    `);
  if ((ownershipCheck.recordset[0] as { Cnt: number }).Cnt !== 2) {
    throw new AppError("Anda tidak memiliki akses ke salah satu tujuan ini.");
  }

  // Read both current effective positions, then write each one the OTHER's
  // value — a real swap, not just "+1"/"-1", so it also works correctly
  // for a stop that never had an UrutanOverride yet (falls back to Urutan).
  const positions = await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId).query(`
      SELECT JadwalDetailID, ISNULL(UrutanOverride, Urutan) AS EffectiveOrder
      FROM DashboardPengirimanJadwalDetail
      WHERE JadwalDetailID IN (@id, @otherId)
    `);
  const rows = positions.recordset as { JadwalDetailID: number; EffectiveOrder: number }[];
  const mine = rows.find((r) => r.JadwalDetailID === jadwalDetailId)!;
  const other = rows.find((r) => r.JadwalDetailID === otherDetailId)!;

  await pool
    .request()
    .input("id", sql.Int, jadwalDetailId)
    .input("otherId", sql.Int, otherDetailId)
    .input("mineOrder", sql.Int, other.EffectiveOrder)
    .input("otherOrder", sql.Int, mine.EffectiveOrder).query(`
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @mineOrder WHERE JadwalDetailID = @id;
      UPDATE DashboardPengirimanJadwalDetail SET UrutanOverride = @otherOrder WHERE JadwalDetailID = @otherId;
    `);
}
