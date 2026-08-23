import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface ActiveIstirahat {
  istirahatId: number;
  keterangan: string;
  waktuMulai: string;
}

// Checked from the driver-app root layout on every load — the lock
// overlay's entire reason for surviving an app kill is that this reads a
// real server row, not client state. NULL WaktuSelesai = currently on break.
export async function getActiveIstirahat(salesmanId: string): Promise<ActiveIstirahat | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      SELECT TOP 1 IstirahatID, Keterangan, WaktuMulai
      FROM DashboardPengirimanIstirahat
      WHERE SalesmanID = @salesmanId AND WaktuSelesai IS NULL
      ORDER BY WaktuMulai DESC
    `);
  const row = result.recordset[0] as { IstirahatID: number; Keterangan: string; WaktuMulai: Date } | undefined;
  if (!row) return null;
  return { istirahatId: row.IstirahatID, keterangan: row.Keterangan, waktuMulai: row.WaktuMulai.toISOString() };
}

export async function startIstirahat(jadwalId: number, salesmanId: string, keterangan: string): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId)
    .input("salesmanId", sql.VarChar(16), salesmanId)
    .input("keterangan", sql.VarChar(200), keterangan).query(`
      INSERT INTO DashboardPengirimanIstirahat (JadwalID, SalesmanID, Keterangan)
      OUTPUT INSERTED.IstirahatID
      VALUES (@jadwalId, @salesmanId, @keterangan)
    `);
  return (result.recordset[0] as { IstirahatID: number }).IstirahatID;
}

// Scoped to salesmanId in the WHERE clause itself (not a separate ownership
// check) — a mismatched id makes the UPDATE affect 0 rows, caught below.
export async function endIstirahat(istirahatId: number, salesmanId: string): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, istirahatId)
    .input("salesmanId", sql.VarChar(16), salesmanId).query(`
      UPDATE DashboardPengirimanIstirahat
      SET WaktuSelesai = GETDATE()
      WHERE IstirahatID = @id AND SalesmanID = @salesmanId AND WaktuSelesai IS NULL
    `);
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Sesi istirahat ini tidak ditemukan atau sudah selesai.");
  }
}

export interface IstirahatSession {
  keterangan: string;
  waktuMulai: string;
  waktuSelesai: string | null;
  durasiMenit: number;
}

// For Validasi Rute's time summary (Task 11) — an in-progress session
// (waktuSelesai still null) has its duration computed up to now, not left
// as 0, so the "Total Istirahat" figure keeps growing live on every
// dialog re-open while a driver is still on break.
export async function getIstirahatForJadwal(jadwalId: number): Promise<IstirahatSession[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT Keterangan, WaktuMulai, WaktuSelesai,
             DATEDIFF(MINUTE, WaktuMulai, ISNULL(WaktuSelesai, GETDATE())) AS DurasiMenit
      FROM DashboardPengirimanIstirahat
      WHERE JadwalID = @jadwalId
      ORDER BY WaktuMulai
    `);
  return (
    result.recordset as { Keterangan: string; WaktuMulai: Date; WaktuSelesai: Date | null; DurasiMenit: number }[]
  ).map((r) => ({
    keterangan: r.Keterangan,
    waktuMulai: r.WaktuMulai.toISOString(),
    waktuSelesai: r.WaktuSelesai ? r.WaktuSelesai.toISOString() : null,
    durasiMenit: r.DurasiMenit,
  }));
}
