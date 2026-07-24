import { getPool, sql } from "@/lib/db";

// Manually-entered "opportunity" capacity per Wilayah — added on top of
// TargetKapasitas (sum of existing mitra Capacity) in
// getPemasaranWilayahDelivery() to form TotalTarget. Keyed by Wilayah
// directly (no surrogate ID) since it's a simple one-row-per-Wilayah
// override, not something referenced elsewhere.
export async function getWilayahPotentialTargets(): Promise<Map<string, number>> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT Wilayah, PotentialTarget FROM DashboardWilayahPotentialTarget`);
  return new Map(
    (result.recordset as { Wilayah: string; PotentialTarget: number }[]).map((r) => [r.Wilayah, r.PotentialTarget])
  );
}

export async function setWilayahPotentialTarget(input: {
  wilayah: string;
  potentialTarget: number;
  userId: string;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("potentialTarget", sql.Decimal(23, 4), input.potentialTarget)
    .input("userId", sql.VarChar(16), input.userId).query(`
      MERGE DashboardWilayahPotentialTarget AS target
      USING (SELECT @wilayah AS Wilayah) AS src
      ON target.Wilayah = src.Wilayah
      WHEN MATCHED THEN
        UPDATE SET PotentialTarget = @potentialTarget, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (Wilayah, PotentialTarget, UpdatedByUserID) VALUES (@wilayah, @potentialTarget, @userId);
    `);
}
