import { getPool, sql } from "@/lib/db";

export async function setMitraCompetitor(input: {
  businessPartnerId: string;
  kompetitor: string | null;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), input.businessPartnerId)
    .input("kompetitor", sql.VarChar(1024), input.kompetitor)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardMitraCompetitor AS target
      USING (SELECT @id AS BusinessPartnerID) AS src
      ON target.BusinessPartnerID = src.BusinessPartnerID
      WHEN MATCHED THEN
        UPDATE SET Kompetitor = @kompetitor, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (BusinessPartnerID, Kompetitor, UpdatedByUserID)
        VALUES (@id, @kompetitor, @userId);
    `);
}
