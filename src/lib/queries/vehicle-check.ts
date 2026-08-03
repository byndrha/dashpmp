import { getPool, sql } from "@/lib/db";
import {
  type VehicleCheckTipe,
  type FuelLevel,
  type JenisFotoKendaraan,
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  type VehicleCheckPhoto,
  type VehicleCheckRow,
} from "@/lib/vehicle-check-types";

// Re-exported so existing server-side importers (upload route, server
// actions) can keep doing `import { ... } from "@/lib/queries/vehicle-check"`
// unchanged. Client components should import these from
// "@/lib/vehicle-check-types" directly instead, to avoid pulling this
// module's `@/lib/db` (mssql) dependency into the client bundle.
export type { VehicleCheckTipe, FuelLevel, JenisFotoKendaraan, VehicleCheckPhoto, VehicleCheckRow };
export { JENIS_FOTO_LIST, JENIS_FOTO_LABEL };

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
    // Gate to Terbit only: a Satpam session could otherwise call the
    // server action directly against a Draft Jadwal's ID (the UI only
    // renders the form once Terbit, but that's not a server-side
    // guarantee). Since a check is immutable and unique per (JadwalID,
    // Tipe), a bogus check attached to a Draft would be permanent, and
    // if that Draft later became Terbit via startBerangkat, the board's
    // timeline math would read a stale JamKembaliAktual predating the
    // real departure.
    const jadwal = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .query(`SELECT Status FROM DashboardPengirimanJadwal WHERE JadwalID = @jadwalId AND IsDeleted = 0`);
    const jadwalStatus = (jadwal.recordset[0] as { Status: string } | undefined)?.Status;
    if (jadwalStatus !== "Terbit") {
      throw new Error("Cek kendaraan hanya dapat diisi untuk keberangkatan yang sudah Terbit.");
    }

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
