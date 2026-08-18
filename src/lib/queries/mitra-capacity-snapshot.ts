import { getPool, sql } from "@/lib/db";

interface CapacitySnapshotRow {
  BusinessPartnerID: string;
  Capacity: number | null;
}

// Lazy snapshot: returns Capacity per BusinessPartnerID as of `monthStart`
// (the 1st of some calendar month, a Date from monthBoundary()). If no
// snapshot row exists yet for that month, one is captured right now from
// LIVE BusinessPartner.Capacity and persisted — the first call for a given
// month locks that month's numbers in; every later call (this month or a
// future one revisiting it) reads the stored snapshot instead of touching
// BusinessPartner again. A monthStart with no snapshot AND already in the
// past (before this feature went live) still gets a snapshot captured from
// TODAY's Capacity, applied retroactively — see spec §2, an explicit
// approximation rather than a historical reconstruction.
export async function getMonthlyCapacitySnapshot(monthStart: Date): Promise<Map<string, number | null>> {
  const pool = await getPool();

  const existing = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .query(`SELECT BusinessPartnerID, Capacity FROM DashboardMitraCapacitySnapshot WHERE MonthStart = @monthStart`);
  if (existing.recordset.length > 0) {
    return new Map((existing.recordset as CapacitySnapshotRow[]).map((r) => [r.BusinessPartnerID, r.Capacity]));
  }

  // Atomic per-row claim (NOT EXISTS), same pattern as addMarketingWilayah
  // in marketing-wilayah.ts — concurrent callers racing for the first query
  // of a new month can't double-insert the same (MonthStart,
  // BusinessPartnerID) pair.
  await pool.request().input("monthStart", sql.Date, monthStart).query(`
    INSERT INTO DashboardMitraCapacitySnapshot (MonthStart, BusinessPartnerID, Capacity)
    SELECT @monthStart, bp.BusinessPartnerID, bp.Capacity
    FROM BusinessPartner bp
    WHERE ISNULL(bp.IsDeleted, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM DashboardMitraCapacitySnapshot s
        WHERE s.MonthStart = @monthStart AND s.BusinessPartnerID = bp.BusinessPartnerID
      )
  `);

  const captured = await pool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .query(`SELECT BusinessPartnerID, Capacity FROM DashboardMitraCapacitySnapshot WHERE MonthStart = @monthStart`);
  return new Map((captured.recordset as CapacitySnapshotRow[]).map((r) => [r.BusinessPartnerID, r.Capacity]));
}
