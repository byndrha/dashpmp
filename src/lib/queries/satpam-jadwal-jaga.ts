import { getPool, sql } from "@/lib/db";
import { getNaiveWibNow } from "@/lib/business-date";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { getSatpamOnDutyNow, type SatpamShiftType, type SatpamJadwalRow } from "@/lib/satpam-shift";

export interface SatpamJadwalDisplayRow extends SatpamJadwalRow {
  satpamNama: string;
  catatan: string | null;
}

interface JadwalJagaDbRow {
  JadwalJagaID: number;
  TanggalUsaha: Date;
  ShiftType: SatpamShiftType;
  SatpamAkunID: number;
  Catatan: string | null;
}

async function attachSatpamNama(rows: JadwalJagaDbRow[]): Promise<SatpamJadwalDisplayRow[]> {
  const nameMap = await getAkunNamaMap(rows.map((r) => r.SatpamAkunID));
  return rows.map((r) => ({
    jadwalJagaId: r.JadwalJagaID,
    tanggalUsaha: r.TanggalUsaha,
    shiftType: r.ShiftType,
    satpamAkunId: r.SatpamAkunID,
    satpamNama: nameMap.get(r.SatpamAkunID) ?? "Akun tidak ditemukan",
    catatan: r.Catatan,
  }));
}

export async function getSatpamJadwalJagaList(startDate: Date, endDate: Date): Promise<SatpamJadwalDisplayRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("startDate", sql.Date, startDate)
    .input("endDate", sql.Date, endDate)
    .query(`
      SELECT JadwalJagaID, TanggalUsaha, ShiftType, SatpamAkunID, Catatan
      FROM DashboardSatpamJadwalJaga
      WHERE IsDeleted = 0 AND TanggalUsaha BETWEEN @startDate AND @endDate
      ORDER BY TanggalUsaha, ShiftType
    `);
  return attachSatpamNama(result.recordset as JadwalJagaDbRow[]);
}

// Ambil TanggalUsaha hari ini DAN kemarin (naive-WIB) supaya shift semalam
// yang masih berjalan (mis. Shift 3/Long Malam yang baru berakhir pagi ini)
// ikut tertangkap -- lihat komentar getSatpamOnDutyNow di satpam-shift.ts.
// `now` default ke getSatpamOnDutyNow's own default (getNaiveWibNow()) --
// TIDAK pernah diberi `new Date()` eksplisit dari pemanggil, supaya
// perbandingannya tetap konsisten naive-WIB (lihat Global Constraints).
export async function getSatpamOnDutyNowRows(now: Date = getNaiveWibNow()): Promise<SatpamJadwalDisplayRow[]> {
  const todayWIB = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayWIB = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const pool = await getPool();
  const result = await pool
    .request()
    .input("yesterdayWIB", sql.Date, yesterdayWIB)
    .input("todayWIB", sql.Date, todayWIB)
    .query(`
      SELECT JadwalJagaID, TanggalUsaha, ShiftType, SatpamAkunID, Catatan
      FROM DashboardSatpamJadwalJaga
      WHERE IsDeleted = 0 AND TanggalUsaha IN (@yesterdayWIB, @todayWIB)
    `);
  const rows = await attachSatpamNama(result.recordset as JadwalJagaDbRow[]);
  // getSatpamOnDutyNow (Task 1) is declared as (SatpamJadwalRow[]) =>
  // SatpamJadwalRow[], not generic, so it widens the return type even
  // though it only filters -- the extra satpamNama/catatan fields survive
  // at runtime. Assertion is safe; it's just recovering the subtype.
  return getSatpamOnDutyNow(rows, now) as SatpamJadwalDisplayRow[];
}

export async function addSatpamJadwalJaga(input: {
  tanggalUsaha: Date;
  shiftType: SatpamShiftType;
  satpamAkunId: number;
  catatan: string | null;
  createdByAkunId: number;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("tanggalUsaha", sql.Date, input.tanggalUsaha)
    .input("shiftType", sql.VarChar(12), input.shiftType)
    .input("satpamAkunId", sql.Int, input.satpamAkunId)
    .input("catatan", sql.VarChar(256), input.catatan)
    .input("createdByAkunId", sql.Int, input.createdByAkunId)
    .query(`
      INSERT INTO DashboardSatpamJadwalJaga (TanggalUsaha, ShiftType, SatpamAkunID, Catatan, CreatedByAkunID)
      VALUES (@tanggalUsaha, @shiftType, @satpamAkunId, @catatan, @createdByAkunId)
    `);
}

export async function removeSatpamJadwalJaga(jadwalJagaId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("jadwalJagaId", sql.Int, jadwalJagaId)
    .query(`UPDATE DashboardSatpamJadwalJaga SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE JadwalJagaID = @jadwalJagaId`);
}
