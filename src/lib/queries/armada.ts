import { getPool, sql } from "@/lib/db";

export interface ArmadaRow {
  ArmadaID: number;
  Nama: string;
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama
    FROM DashboardArmada
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return result.recordset;
}

export async function createArmada(nama: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), nama).query(`
      INSERT INTO DashboardArmada (Nama, IsDeleted, ModifiedDate)
      OUTPUT inserted.ArmadaID
      VALUES (@nama, 0, GETDATE())
    `);
  return (result.recordset[0] as { ArmadaID: number }).ArmadaID;
}

export async function updateArmada(id: number, nama: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), nama)
    .query(`UPDATE DashboardArmada SET Nama = @nama, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}

export async function deleteArmada(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardArmada SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}
