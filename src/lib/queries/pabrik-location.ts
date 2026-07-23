import { getPool, sql } from "@/lib/db";

export interface PabrikLocation {
  latitude: number;
  longitude: number;
  alamat: string | null;
}

// Same coordinate the DDL seeds DashboardPabrikLocation with — only used as
// a last-resort fallback if that single row is ever somehow missing (should
// never happen; Task 0's migration always inserts exactly one row).
const PABRIK_FALLBACK: PabrikLocation = {
  latitude: -7.8462825,
  longitude: 111.4759937,
  alamat: null,
};

export async function getPabrikLocation(): Promise<PabrikLocation> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 Latitude, Longitude, Alamat FROM DashboardPabrikLocation ORDER BY ID
  `);
  const row = result.recordset[0] as { Latitude: number; Longitude: number; Alamat: string | null } | undefined;
  if (!row) return PABRIK_FALLBACK;
  return { latitude: row.Latitude, longitude: row.Longitude, alamat: row.Alamat };
}

export async function setPabrikLocation(input: {
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardPabrikLocation ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat);

  if (id != null) {
    await request
      .input("id", sql.Int, id)
      .query(`UPDATE DashboardPabrikLocation SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, ModifiedDate = GETDATE() WHERE ID = @id`);
  } else {
    // Defensive only — Task 0's migration always seeds one row, so this
    // branch shouldn't run in practice.
    await request.query(`INSERT INTO DashboardPabrikLocation (Latitude, Longitude, Alamat) VALUES (@lat, @lng, @alamat)`);
  }
}
