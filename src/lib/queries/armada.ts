import { getPool, sql } from "@/lib/db";

export const ARMADA_STATUS = ["Baik", "Rusak", "Perbaikan", "Tertahan"] as const;
export type ArmadaStatus = (typeof ARMADA_STATUS)[number];

export interface ArmadaRow {
  ArmadaID: number;
  Nama: string;
  PlatNomor: string | null;
  Brand: string | null;
  Model: string | null;
  KonsumsiBBM: number | null;
  KapasitasMaks: number | null;
  Status: ArmadaStatus;
  FotoPath: string | null;
}

export interface ArmadaInput {
  nama: string;
  platNomor: string | null;
  brand: string | null;
  model: string | null;
  konsumsiBBM: number | null;
  kapasitasMaks: number | null;
  status: ArmadaStatus;
  fotoPath: string | null;
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath
    FROM DashboardArmada
    WHERE IsDeleted = 0
    ORDER BY Nama
  `);
  return result.recordset;
}

export async function createArmada(input: ArmadaInput): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("nama", sql.VarChar(128), input.nama)
    .input("platNomor", sql.VarChar(20), input.platNomor)
    .input("brand", sql.VarChar(64), input.brand)
    .input("model", sql.VarChar(64), input.model)
    .input("konsumsiBBM", sql.Decimal(10, 2), input.konsumsiBBM)
    .input("kapasitasMaks", sql.Decimal(23, 4), input.kapasitasMaks)
    .input("status", sql.VarChar(20), input.status)
    .input("fotoPath", sql.VarChar(256), input.fotoPath).query(`
      INSERT INTO DashboardArmada
        (Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath, IsDeleted, ModifiedDate)
      OUTPUT inserted.ArmadaID
      VALUES
        (@nama, @platNomor, @brand, @model, @konsumsiBBM, @kapasitasMaks, @status, @fotoPath, 0, GETDATE())
    `);
  return (result.recordset[0] as { ArmadaID: number }).ArmadaID;
}

export async function updateArmada(id: number, input: ArmadaInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("nama", sql.VarChar(128), input.nama)
    .input("platNomor", sql.VarChar(20), input.platNomor)
    .input("brand", sql.VarChar(64), input.brand)
    .input("model", sql.VarChar(64), input.model)
    .input("konsumsiBBM", sql.Decimal(10, 2), input.konsumsiBBM)
    .input("kapasitasMaks", sql.Decimal(23, 4), input.kapasitasMaks)
    .input("status", sql.VarChar(20), input.status)
    .input("fotoPath", sql.VarChar(256), input.fotoPath).query(`
      UPDATE DashboardArmada SET
        Nama = @nama, PlatNomor = @platNomor, Brand = @brand, Model = @model,
        KonsumsiBBM = @konsumsiBBM, KapasitasMaks = @kapasitasMaks, Status = @status, FotoPath = @fotoPath,
        ModifiedDate = GETDATE()
      WHERE ArmadaID = @id
    `);
}

export async function deleteArmada(id: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .query(`UPDATE DashboardArmada SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE ArmadaID = @id`);
}
