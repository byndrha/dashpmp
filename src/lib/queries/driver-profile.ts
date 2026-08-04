import { getPool, sql } from "@/lib/db";

// Driver identity itself is the real ERP Salesman table (see
// getDriverOptions in delivery.ts) — this is a dashboard-only extension
// (personal data + SIM list + dropdown-visibility flag) keyed by the same
// SalesmanID, same DashboardXxx-side-table pattern used throughout this
// app to extend ERP entities without touching ERP schema.
export interface DriverProfileRow {
  SalesmanID: string;
  Name: string;
  TempatLahir: string | null;
  TanggalLahir: string | Date | null;
  NIK: string | null;
  Alamat: string | null;
  BergabungSejak: string | Date | null;
  HariKerja: string | null;
  JamMulaiKerja: string | null;
  JamSelesaiKerja: string | null;
  IsHiddenFromDropdown: boolean;
  SimTypes: string[];
}

// Excludes '0127' ("Ambil Sendiri"/TakeAway) same as getDriverOptions —
// that code is never a real driver, so it has no business showing up in
// driver management either.
export async function getDriverProfiles(): Promise<DriverProfileRow[]> {
  const pool = await getPool();
  const [driversResult, simResult] = await Promise.all([
    pool.request().query(`
      SELECT
          sm.SalesmanID,
          sm.Name,
          dp.TempatLahir,
          dp.TanggalLahir,
          dp.NIK,
          dp.Alamat,
          dp.BergabungSejak,
          dp.HariKerja,
          dp.JamMulaiKerja,
          dp.JamSelesaiKerja,
          ISNULL(dp.IsHiddenFromDropdown, 0) AS IsHiddenFromDropdown
      FROM Salesman sm
      LEFT JOIN DashboardDriverProfile dp ON dp.SalesmanID = sm.SalesmanID
      WHERE ISNULL(sm.IsDeleted, 0) = 0
        AND sm.SalesmanID <> '0127'
        AND LTRIM(RTRIM(ISNULL(sm.Name, ''))) <> ''
      ORDER BY sm.Name
    `),
    pool.request().query(`
      SELECT SalesmanID, JenisSim FROM DashboardDriverSim WHERE IsDeleted = 0 ORDER BY JenisSim
    `),
  ]);

  const simsBySalesman = new Map<string, string[]>();
  for (const row of simResult.recordset as { SalesmanID: string; JenisSim: string }[]) {
    const list = simsBySalesman.get(row.SalesmanID) ?? [];
    list.push(row.JenisSim);
    simsBySalesman.set(row.SalesmanID, list);
  }

  return (driversResult.recordset as Omit<DriverProfileRow, "SimTypes">[]).map((row) => ({
    ...row,
    SimTypes: simsBySalesman.get(row.SalesmanID) ?? [],
  }));
}

export interface SaveDriverProfileInput {
  salesmanId: string;
  tempatLahir: string | null;
  tanggalLahir: string | null;
  nik: string | null;
  alamat: string | null;
  bergabungSejak: string | null;
  hariKerja: string | null;
  jamMulaiKerja: string | null;
  jamSelesaiKerja: string | null;
  isHiddenFromDropdown: boolean;
  simTypes: string[];
}

// Upserts the profile row (MERGE — same pattern as DashboardMitraLocation
// etc.) then fully replaces the SIM list, since the edit form always
// submits the complete set rather than incremental add/remove calls.
export async function saveDriverProfile(input: SaveDriverProfileInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .input("tempatLahir", sql.VarChar(100), input.tempatLahir)
    .input("tanggalLahir", sql.Date, input.tanggalLahir)
    .input("nik", sql.VarChar(32), input.nik)
    .input("alamat", sql.VarChar(255), input.alamat)
    .input("bergabungSejak", sql.Date, input.bergabungSejak)
    .input("hariKerja", sql.VarChar(100), input.hariKerja)
    .input("jamMulaiKerja", sql.VarChar(5), input.jamMulaiKerja)
    .input("jamSelesaiKerja", sql.VarChar(5), input.jamSelesaiKerja)
    .input("isHidden", sql.Bit, input.isHiddenFromDropdown).query(`
      MERGE DashboardDriverProfile AS target
      USING (SELECT @salesmanId AS SalesmanID) AS src
      ON target.SalesmanID = src.SalesmanID
      WHEN MATCHED THEN UPDATE SET
        TempatLahir = @tempatLahir, TanggalLahir = @tanggalLahir, NIK = @nik, Alamat = @alamat,
        BergabungSejak = @bergabungSejak, HariKerja = @hariKerja, JamMulaiKerja = @jamMulaiKerja,
        JamSelesaiKerja = @jamSelesaiKerja, IsHiddenFromDropdown = @isHidden, ModifiedDate = GETDATE()
      WHEN NOT MATCHED THEN INSERT
        (SalesmanID, TempatLahir, TanggalLahir, NIK, Alamat, BergabungSejak, HariKerja, JamMulaiKerja, JamSelesaiKerja, IsHiddenFromDropdown, ModifiedDate)
        VALUES (@salesmanId, @tempatLahir, @tanggalLahir, @nik, @alamat, @bergabungSejak, @hariKerja, @jamMulaiKerja, @jamSelesaiKerja, @isHidden, GETDATE());
    `);

  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), input.salesmanId)
    .query(`DELETE FROM DashboardDriverSim WHERE SalesmanID = @salesmanId`);

  for (const jenisSim of input.simTypes) {
    await pool
      .request()
      .input("salesmanId", sql.VarChar(16), input.salesmanId)
      .input("jenisSim", sql.VarChar(10), jenisSim)
      .query(`INSERT INTO DashboardDriverSim (SalesmanID, JenisSim, IsDeleted) VALUES (@salesmanId, @jenisSim, 0)`);
  }
}

// Hard-deletes only this SalesmanID's dashboard-side extension data
// (DashboardDriverProfile + DashboardDriverSim) — the real ERP Salesman
// row, and any historical SalesOrder/DeliveryOrder referencing this
// SalesmanID, are never touched. Matches saveDriverProfile's own
// no-transaction style for this same table pair (a partial failure here
// just leaves stale SIM rows for a profile-less SalesmanID, which
// re-running this same delete cleans up — not a real data-integrity risk
// the way the SalesOrder/SalesOrderDetail pair in sales-order.ts is).
export async function deleteDriverProfile(salesmanId: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`DELETE FROM DashboardDriverSim WHERE SalesmanID = @salesmanId`);
  await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .query(`DELETE FROM DashboardDriverProfile WHERE SalesmanID = @salesmanId`);
}
