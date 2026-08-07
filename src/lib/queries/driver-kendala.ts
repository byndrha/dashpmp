import { getPool, sql } from "@/lib/db";
import type { JenisKendala } from "@/lib/kendala-options";

// Persisted so it's visible later from an admin/dispatcher view (not built
// yet — this is the data layer only) — the driver-app screen itself just
// stops showing its live ETA countdown once this succeeds, replacing it
// with a "kendala dilaporkan" state.
export async function recordKendala(
  jadwalId: number,
  jadwalDetailId: number,
  salesmanId: string,
  jenisKendala: JenisKendala,
  hubungiTeknisi: boolean
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("jadwalDetailId", sql.Int, jadwalDetailId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("jenisKendala", sql.VarChar(50), jenisKendala)
    .input("hubungiTeknisi", sql.Bit, hubungiTeknisi).query(`
      INSERT INTO DashboardPengirimanKendala (JadwalID, JadwalDetailID, SalesmanID, JenisKendala, HubungiTeknisi)
      VALUES (@jadwalId, @jadwalDetailId, @salesmanId, @jenisKendala, @hubungiTeknisi)
    `);
}
