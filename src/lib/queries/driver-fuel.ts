import { getPool, sql } from "@/lib/db";

// Simple refuel log for the driver-app Pengiriman screen's "Isi BBM"
// button — timestamp + liter amount only, no photo/receipt (that can be a
// follow-up if ever needed). One row per tap; no upsert/edit path.
export async function recordFuelLog(jadwalId: number, salesmanId: string, liter: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("liter", sql.Decimal(10, 2), liter).query(`
      INSERT INTO DashboardPengirimanBBM (JadwalID, SalesmanID, Liter)
      VALUES (@jadwalId, @salesmanId, @liter)
    `);
}
