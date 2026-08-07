import { getPool, sql } from "@/lib/db";
import { ARMADA_STATUS, type ArmadaStatus } from "@/lib/armada-status";
import { FUEL_TYPES, type FuelType } from "@/lib/armada-fuel";

export { ARMADA_STATUS, type ArmadaStatus, FUEL_TYPES, type FuelType };

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
  JenisBBM: FuelType | null;
  BiayaBBMPerLiter: number | null;
  PajakLimaTahunan: string | Date | null;
  BiayaPajakLimaTahunan: number | null;
  // Links this armada to its real ERP vehicle record (ExpeditionDetail,
  // ExpeditionID '012' — the company's own fleet) — see expedition.ts. Null
  // until linked via Kelola Armada; startBerangkat falls back to Nama for
  // DeliveryOrder.VehicleNo when unlinked.
  ExpeditionDetailID: string | null;
  // Shown on the driver-app's Isi BBM screen for the driver to scan at the
  // pump — one QR per vehicle, uploaded here by admin (same pattern as
  // FotoPath).
  QrMyPertaminaPath: string | null;
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
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  pajakLimaTahunan: string | null;
  biayaPajakLimaTahunan: number | null;
  expeditionDetailId: string | null;
  qrMyPertaminaPath: string | null;
}

export async function getArmadaList(): Promise<ArmadaRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ArmadaID, Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath,
           JenisBBM, BiayaBBMPerLiter, PajakLimaTahunan, BiayaPajakLimaTahunan, ExpeditionDetailID, QrMyPertaminaPath
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
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("jenisBBM", sql.VarChar(20), input.jenisBBM)
    .input("biayaBBMPerLiter", sql.Decimal(18, 2), input.biayaBBMPerLiter)
    .input("pajakLimaTahunan", sql.Date, input.pajakLimaTahunan)
    .input("biayaPajakLimaTahunan", sql.Decimal(18, 2), input.biayaPajakLimaTahunan)
    .input("expeditionDetailId", sql.VarChar(16), input.expeditionDetailId)
    .input("qrMyPertaminaPath", sql.VarChar(256), input.qrMyPertaminaPath).query(`
      INSERT INTO DashboardArmada
        (Nama, PlatNomor, Brand, Model, KonsumsiBBM, KapasitasMaks, Status, FotoPath, IsDeleted, ModifiedDate,
         JenisBBM, BiayaBBMPerLiter, PajakLimaTahunan, BiayaPajakLimaTahunan, ExpeditionDetailID, QrMyPertaminaPath)
      OUTPUT inserted.ArmadaID
      VALUES
        (@nama, @platNomor, @brand, @model, @konsumsiBBM, @kapasitasMaks, @status, @fotoPath, 0, GETDATE(),
         @jenisBBM, @biayaBBMPerLiter, @pajakLimaTahunan, @biayaPajakLimaTahunan, @expeditionDetailId, @qrMyPertaminaPath)
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
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("jenisBBM", sql.VarChar(20), input.jenisBBM)
    .input("biayaBBMPerLiter", sql.Decimal(18, 2), input.biayaBBMPerLiter)
    .input("pajakLimaTahunan", sql.Date, input.pajakLimaTahunan)
    .input("biayaPajakLimaTahunan", sql.Decimal(18, 2), input.biayaPajakLimaTahunan)
    .input("expeditionDetailId", sql.VarChar(16), input.expeditionDetailId)
    .input("qrMyPertaminaPath", sql.VarChar(256), input.qrMyPertaminaPath).query(`
      UPDATE DashboardArmada SET
        Nama = @nama, PlatNomor = @platNomor, Brand = @brand, Model = @model,
        KonsumsiBBM = @konsumsiBBM, KapasitasMaks = @kapasitasMaks, Status = @status, FotoPath = @fotoPath,
        JenisBBM = @jenisBBM, BiayaBBMPerLiter = @biayaBBMPerLiter,
        PajakLimaTahunan = @pajakLimaTahunan, BiayaPajakLimaTahunan = @biayaPajakLimaTahunan,
        ExpeditionDetailID = @expeditionDetailId, QrMyPertaminaPath = @qrMyPertaminaPath,
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
