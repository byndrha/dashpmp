import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";

// Two-phase BBM log, matching the driver-app Isi BBM screen's flow:
// 1. recordMasukSpbu — tapping "Masuk SPBU" creates a pending row (liter/
//    nominal still null) so the timestamp of arriving at the pump is
//    captured even if the driver abandons the dialog before finishing.
// 2. updateFuelLog — "Simpan" fills in the liter amount and the
//    asli/ekstra split, computed by the caller from this Jadwal's Armada
//    quota (see getJadwalHeader).
export async function recordMasukSpbu(jadwalId: number, salesmanId: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      INSERT INTO DashboardPengirimanBBM (JadwalID, SalesmanID, WaktuMasukSpbu)
      OUTPUT inserted.BBMID
      VALUES (@jadwalId, @salesmanId, GETDATE())
    `);
  return (result.recordset[0] as { BBMID: number }).BBMID;
}

export async function updateFuelLog(
  bbmId: number,
  salesmanId: string,
  liter: number,
  nominalAsli: number,
  nominalEkstra: number
): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("bbmId", sql.Int, bbmId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("liter", sql.Decimal(10, 2), liter)
    .input("nominalAsli", sql.Decimal(18, 2), nominalAsli)
    .input("nominalEkstra", sql.Decimal(18, 2), nominalEkstra).query(`
      UPDATE DashboardPengirimanBBM
      SET Liter = @liter, NominalAsli = @nominalAsli, NominalEkstra = @nominalEkstra, WaktuIsi = GETDATE()
      WHERE BBMID = @bbmId AND SalesmanID = @salesmanId
    `);
  // SalesmanID in the WHERE clause means a mismatched owner silently
  // matches zero rows rather than updating someone else's log — same
  // "not found" surfaced either way, no separate ownership-check query.
  if (result.rowsAffected[0] === 0) throw new AppError("Catatan Masuk SPBU tidak ditemukan.");
}

export interface BbmShiftRow {
  salesmanId: string;
  driverName: string | null;
  liter: number;
  nominalAsli: number;
  nominalEkstra: number;
  waktuIsi: string; // ISO
}

// Grouped by WaktuIsi's own real-time shift window (when the money left the
// register), NOT the parent Jadwal's own JamSelesaiMuat-based shift --
// deliberately different from laporan-muatan-distribusi.ts's BBMPerJadwal
// CTE, which groups by the Jadwal's loading shift for a different report.
// See this plan's Global Constraints.
export async function getBbmUntukShift(tanggalUsaha: string, shift: ShiftNumber): Promise<BbmShiftRow[]> {
  const pool = await getPool();
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const result = await pool
    .request()
    .input("start", sql.DateTime, window.start)
    .input("end", sql.DateTime, window.end).query(`
      SELECT b.SalesmanID, sm.Name AS DriverName, b.Liter, b.NominalAsli, b.NominalEkstra, b.WaktuIsi
      FROM DashboardPengirimanBBM b
      LEFT JOIN Salesman sm ON sm.SalesmanID = b.SalesmanID
      WHERE b.WaktuIsi IS NOT NULL AND b.WaktuIsi BETWEEN @start AND @end
      ORDER BY b.WaktuIsi
    `);
  return (result.recordset as { SalesmanID: string; DriverName: string | null; Liter: number; NominalAsli: number; NominalEkstra: number; WaktuIsi: Date }[]).map(
    (r) => ({
      salesmanId: r.SalesmanID,
      driverName: r.DriverName,
      liter: r.Liter,
      nominalAsli: r.NominalAsli,
      nominalEkstra: r.NominalEkstra,
      waktuIsi: r.WaktuIsi.toISOString(),
    })
  );
}
