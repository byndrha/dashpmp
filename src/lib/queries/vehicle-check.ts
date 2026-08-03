import { getPool, sql } from "@/lib/db";

export type VehicleCheckTipe = "BERANGKAT" | "DATANG";
export type FuelLevel = "E" | "1/4" | "1/2" | "3/4" | "F";
export type JenisFotoKendaraan =
  | "DEPAN"
  | "SAMPING_KANAN"
  | "SAMPING_KIRI"
  | "BELAKANG"
  | "BOX_MUATAN"
  | "KABIN";

export const JENIS_FOTO_LIST: JenisFotoKendaraan[] = [
  "DEPAN",
  "SAMPING_KANAN",
  "SAMPING_KIRI",
  "BELAKANG",
  "BOX_MUATAN",
  "KABIN",
];

export const JENIS_FOTO_LABEL: Record<JenisFotoKendaraan, string> = {
  DEPAN: "Depan",
  SAMPING_KANAN: "Samping Kanan",
  SAMPING_KIRI: "Samping Kiri",
  BELAKANG: "Belakang",
  BOX_MUATAN: "Box Muatan",
  KABIN: "Kabin (Area Speedometer)",
};

export interface VehicleCheckPhoto {
  jenisFoto: JenisFotoKendaraan;
  filePath: string;
}

export interface VehicleCheckRow {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
}

export async function getVehicleChecksForJadwal(jadwalId: number): Promise<VehicleCheckRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`
      SELECT vc.VehicleCheckID, vc.JadwalID, vc.Tipe, vc.OdometerKM, vc.FuelLevel,
             vc.CheckedByUserID, vc.CheckedAt,
             p.JenisFoto, p.FilePath
      FROM DashboardVehicleCheck vc
      LEFT JOIN DashboardVehicleCheckPhoto p ON p.VehicleCheckID = vc.VehicleCheckID
      WHERE vc.JadwalID = @jadwalId
      ORDER BY vc.Tipe, p.JenisFoto
    `);

  const rows = result.recordset as {
    VehicleCheckID: number;
    JadwalID: number;
    Tipe: VehicleCheckTipe;
    OdometerKM: number;
    FuelLevel: FuelLevel;
    CheckedByUserID: string;
    CheckedAt: Date;
    JenisFoto: JenisFotoKendaraan | null;
    FilePath: string | null;
  }[];

  const byId = new Map<number, VehicleCheckRow>();
  for (const r of rows) {
    let entry = byId.get(r.VehicleCheckID);
    if (!entry) {
      entry = {
        vehicleCheckId: r.VehicleCheckID,
        jadwalId: r.JadwalID,
        tipe: r.Tipe,
        odometerKM: r.OdometerKM,
        fuelLevel: r.FuelLevel,
        checkedByUserId: r.CheckedByUserID,
        checkedAt: r.CheckedAt.toISOString(),
        photos: [],
      };
      byId.set(r.VehicleCheckID, entry);
    }
    if (r.JenisFoto && r.FilePath) {
      entry.photos.push({ jenisFoto: r.JenisFoto, filePath: r.FilePath });
    }
  }
  return [...byId.values()];
}

export async function createVehicleCheck(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  userId: string;
  photos: VehicleCheckPhoto[];
}): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const existing = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = @tipe`);
    if (existing.recordset.length > 0) {
      throw new Error(
        input.tipe === "BERANGKAT"
          ? "Cek Berangkat untuk keberangkatan ini sudah pernah diisi."
          : "Cek Datang untuk keberangkatan ini sudah pernah diisi."
      );
    }

    const header = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .input("odometerKM", sql.Int, input.odometerKM)
      .input("fuelLevel", sql.VarChar(4), input.fuelLevel)
      .input("userId", sql.VarChar(16), input.userId).query(`
        INSERT INTO DashboardVehicleCheck (JadwalID, Tipe, OdometerKM, FuelLevel, CheckedByUserID)
        OUTPUT INSERTED.VehicleCheckID
        VALUES (@jadwalId, @tipe, @odometerKM, @fuelLevel, @userId)
      `);
    const vehicleCheckId = (header.recordset[0] as { VehicleCheckID: number }).VehicleCheckID;

    for (const photo of input.photos) {
      await new sql.Request(transaction)
        .input("vehicleCheckId", sql.Int, vehicleCheckId)
        .input("jenisFoto", sql.VarChar(16), photo.jenisFoto)
        .input("filePath", sql.VarChar(256), photo.filePath).query(`
          INSERT INTO DashboardVehicleCheckPhoto (VehicleCheckID, JenisFoto, FilePath)
          VALUES (@vehicleCheckId, @jenisFoto, @filePath)
        `);
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Bulk lookup for the Papan Pengiriman board — one DATANG CheckedAt per
// JadwalID, used to replace the estimated "Kembali ke Pabrik" marker with a
// real timestamp when a Satpam has actually recorded the vehicle's return.
export async function getJamKembaliAktualMap(jadwalIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (jadwalIds.length === 0) return map;

  const pool = await getPool();
  const request = pool.request();
  const inClause = jadwalIds.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query(`
    SELECT JadwalID, CheckedAt FROM DashboardVehicleCheck
    WHERE Tipe = 'DATANG' AND JadwalID IN (${inClause.join(", ")})
  `);
  for (const r of result.recordset as { JadwalID: number; CheckedAt: Date }[]) {
    map.set(r.JadwalID, r.CheckedAt.toISOString());
  }
  return map;
}
