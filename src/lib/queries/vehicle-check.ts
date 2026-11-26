import { getPool, sql } from "@/lib/db";
import {
  type VehicleCheckTipe,
  type FuelBar,
  type JenisFotoKendaraan,
  JENIS_FOTO_LIST,
  JENIS_FOTO_BERANGKAT,
  JENIS_FOTO_LABEL,
  POSISI_BAN,
  PSI_MIN,
  PSI_MAKS,
  jumlahBanArmada,
  type PosisiBan,
  type TekananBan,
  type VehicleCheckPhoto,
  type VehicleCheckRow,
} from "@/lib/vehicle-check-types";
import { AppError } from "@/lib/action-result";

// Re-exported so existing server-side importers (upload route, server
// actions) can keep doing `import { ... } from "@/lib/queries/vehicle-check"`
// unchanged. Client components should import these from
// "@/lib/vehicle-check-types" directly instead, to avoid pulling this
// module's `@/lib/db` (mssql) dependency into the client bundle.
export type { VehicleCheckTipe, FuelBar, JenisFotoKendaraan, VehicleCheckPhoto, VehicleCheckRow };
export { JENIS_FOTO_LIST, JENIS_FOTO_BERANGKAT, JENIS_FOTO_LABEL };

export async function getVehicleChecksForJadwal(jadwalId: number): Promise<VehicleCheckRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .query(`
      SELECT vc.VehicleCheckID, vc.JadwalID, vc.Tipe, vc.OdometerKM, vc.FuelBar, vc.MuatanQty, vc.Remark,
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
    FuelBar: FuelBar;
    MuatanQty: number;
    Remark: string | null;
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
        fuelBar: r.FuelBar,
        muatanQty: r.MuatanQty,
        remark: r.Remark,
        checkedByUserId: r.CheckedByUserID,
        checkedAt: r.CheckedAt.toISOString(),
        photos: [],
        tekananBan: [],
      };
      byId.set(r.VehicleCheckID, entry);
    }
    if (r.JenisFoto && r.FilePath) {
      entry.photos.push({ jenisFoto: r.JenisFoto, filePath: r.FilePath });
    }
  }
  if (byId.size > 0) {
    const banReq = pool.request();
    const ids = [...byId.keys()];
    ids.forEach((id, i) => banReq.input(`v${i}`, sql.Int, id));
    const ban = await banReq.query(`
      SELECT VehicleCheckID, Posisi, PSI FROM DashboardVehicleCheckBan
      WHERE VehicleCheckID IN (${ids.map((_, i) => `@v${i}`).join(", ")})
    `);
    for (const b of ban.recordset as { VehicleCheckID: number; Posisi: PosisiBan; PSI: number }[]) {
      byId.get(b.VehicleCheckID)?.tekananBan.push({ posisi: b.Posisi, psi: Number(b.PSI) });
    }
    // Urut sesuai posisi tampil (depan dulu, kiri ke kanan).
    const urutan = [...POSISI_BAN[6], ...POSISI_BAN[4]];
    for (const c of byId.values()) c.tekananBan.sort((x, y) => urutan.indexOf(x.posisi) - urutan.indexOf(y.posisi));
  }
  return [...byId.values()];
}

export async function createVehicleCheck(input: {
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelBar: FuelBar;
  muatanQty: number;
  remark: string | null;
  userId: string;
  photos: VehicleCheckPhoto[];
  tekananBan: TekananBan[];
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
      throw new AppError("Cek kendaraan hanya dapat diisi untuk keberangkatan yang sudah Terbit.");
    }

    const existing = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .query(`SELECT VehicleCheckID FROM DashboardVehicleCheck WHERE JadwalID = @jadwalId AND Tipe = @tipe`);
    if (existing.recordset.length > 0) {
      throw new AppError(
        input.tipe === "BERANGKAT"
          ? "Cek Berangkat untuk keberangkatan ini sudah pernah diisi."
          : "Cek Datang untuk keberangkatan ini sudah pernah diisi."
      );
    }

    const header = await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("tipe", sql.VarChar(10), input.tipe)
      .input("odometerKM", sql.Int, input.odometerKM)
      .input("fuelBar", sql.TinyInt, input.fuelBar)
      .input("muatanQty", sql.Int, input.muatanQty)
      .input("remark", sql.NVarChar(500), input.remark)
      .input("userId", sql.VarChar(16), input.userId).query(`
        INSERT INTO DashboardVehicleCheck (JadwalID, Tipe, OdometerKM, FuelBar, MuatanQty, Remark, CheckedByUserID)
        OUTPUT INSERTED.VehicleCheckID
        VALUES (@jadwalId, @tipe, @odometerKM, @fuelBar, @muatanQty, @remark, @userId)
      `);
    const vehicleCheckId = (header.recordset[0] as { VehicleCheckID: number }).VehicleCheckID;

    // Cek Berangkat wajib mencatat tekanan SETIAP ban armada ini (posisi
    // sesuai jumlah ban armada); Cek Datang tidak mencatat tekanan ban.
    if (input.tipe === "BERANGKAT") {
      const armada = await new sql.Request(transaction)
        .input("jadwalId", sql.Int, input.jadwalId)
        .query(`
          SELECT a.JumlahBan, a.Brand FROM DashboardPengirimanJadwal j
          JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
          WHERE j.JadwalID = @jadwalId
        `);
      const a = armada.recordset[0] as { JumlahBan: number | null; Brand: string | null } | undefined;
      const wajib = POSISI_BAN[jumlahBanArmada({ JumlahBan: a?.JumlahBan ?? null, Brand: a?.Brand ?? null })];
      const masuk = new Map(input.tekananBan.map((b) => [b.posisi, b.psi]));
      if (masuk.size !== input.tekananBan.length || wajib.some((p) => !masuk.has(p)) || masuk.size !== wajib.length) {
        throw new AppError(`Tekanan ${wajib.length} ban wajib diisi semua.`);
      }
      for (const b of input.tekananBan) {
        if (!(Number.isFinite(b.psi) && b.psi >= PSI_MIN && b.psi <= PSI_MAKS)) {
          throw new AppError(`Tekanan ban harus angka ${PSI_MIN}–${PSI_MAKS} PSI.`);
        }
      }
      for (const b of input.tekananBan) {
        await new sql.Request(transaction)
          .input("vehicleCheckId", sql.Int, vehicleCheckId)
          .input("posisi", sql.VarChar(12), b.posisi)
          .input("psi", sql.Decimal(5, 1), Math.round(b.psi * 10) / 10)
          .query(`INSERT INTO DashboardVehicleCheckBan (VehicleCheckID, Posisi, PSI) VALUES (@vehicleCheckId, @posisi, @psi)`);
      }
    }

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
