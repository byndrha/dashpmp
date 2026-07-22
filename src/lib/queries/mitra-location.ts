import { getPool, sql } from "@/lib/db";

export interface MitraLocation {
  BusinessPartnerID: string;
  Latitude: number;
  Longitude: number;
  Alamat: string | null;
}

export async function getMitraLocation(businessPartnerId: string): Promise<MitraLocation | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.VarChar(16), businessPartnerId)
    .query(`
      SELECT BusinessPartnerID, Latitude, Longitude, Alamat
      FROM DashboardMitraLocation
      WHERE BusinessPartnerID = @id
    `);
  return (result.recordset[0] as MitraLocation | undefined) ?? null;
}

export async function getMitraLocations(): Promise<Map<string, MitraLocation>> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BusinessPartnerID, Latitude, Longitude, Alamat
    FROM DashboardMitraLocation
  `);
  const rows = result.recordset as MitraLocation[];
  return new Map(rows.map((r) => [r.BusinessPartnerID, r]));
}

export async function setMitraLocation(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), input.businessPartnerId)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("alamat", sql.VarChar(512), input.alamat)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMitraLocation AS target
      USING (SELECT @id AS BusinessPartnerID) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID
      WHEN MATCHED THEN
        UPDATE SET Latitude = @lat, Longitude = @lng, Alamat = @alamat, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, Latitude, Longitude, Alamat, CreatedByUserID)
        VALUES (@id, @lat, @lng, @alamat, @userId);
    `);
}
