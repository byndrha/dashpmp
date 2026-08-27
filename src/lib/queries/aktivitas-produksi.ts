import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
export { hitungTotalDenda, hitungKontribusiPerOrang } from "@/lib/aktivitas-produksi-shared";

export interface AktivitasShiftInfo {
  aktivitasId: number | null; // null when this shift has never been saved yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  stafOperasionalAkunId: number | null;
  stokEsSebelumnya10KG: number;
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
}

export interface QtyPerMesinRow {
  mesinId: number;
  mesinNama: string;
  qty10KG: number;
}

export interface QtyRecap {
  perMesin: QtyPerMesinRow[];
  total10KG: number;
  total5KG: number;
  totalKantongEkivalen: number;
}

export interface KerusakanInput {
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
}

export function getCurrentShift(): { tanggalUsaha: string; shift: ShiftNumber } {
  const { shift, businessDate } = getReportShift("work");
  return { tanggalUsaha: businessDate.toISOString().slice(0, 10), shift };
}

async function getTotalStokEs10KG(pool: sql.ConnectionPool): Promise<number> {
  const result = await pool.request().query(`
    SELECT ISNULL(SUM(SisaQty10KG), 0) AS Total FROM DashboardProduksiBatch WHERE IsDeleted = 0 AND SisaQty10KG > 0
  `);
  return (result.recordset[0] as { Total: number }).Total;
}

// Creates the shift's row on first write (any of the upsert functions
// below), snapshotting StokEsSebelumnya10KG at that exact moment — never
// re-snapshotted after. A tiny check-then-insert race is possible under
// truly concurrent first-writes to the same brand-new shift (the UNIQUE
// constraint would reject the loser with a duplicate-key error rather
// than corrupt data) — accepted, matching this codebase's existing
// MERGE-without-HOLDLOCK precedent across 14+ query files for a
// low-traffic internal tool.
async function ensureAktivitasRow(pool: sql.ConnectionPool, tanggalUsaha: string, shift: ShiftNumber, akunId: number): Promise<number> {
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT AktivitasID FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s`);
  if (existing.recordset.length > 0) return (existing.recordset[0] as { AktivitasID: number }).AktivitasID;

  const stokEs = await getTotalStokEs10KG(pool);
  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftMulai = getShiftWindow(businessDate, shift, "work").start;
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("stokEs", sql.Int, stokEs)
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardAktivitasProduksiShift (TanggalUsaha, Shift, ShiftMulai, StokEsSebelumnya10KG, CreatedByAkunID)
      OUTPUT INSERTED.AktivitasID
      VALUES (@t, @s, @shiftMulai, @stokEs, @akunId)
    `);
  return (result.recordset[0] as { AktivitasID: number }).AktivitasID;
}

interface RawAktivitasRow {
  AktivitasID: number;
  StafOperasionalAkunID: number | null;
  StokEsSebelumnya10KG: number;
  PecahKemasanQty: number;
  EsJatuhQty: number;
  GantiReturnQty: number;
  SealerJebolQty: number;
}

function mapAktivitasRow(r: RawAktivitasRow, tanggalUsaha: string, shift: ShiftNumber): AktivitasShiftInfo {
  return {
    aktivitasId: r.AktivitasID,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    stafOperasionalAkunId: r.StafOperasionalAkunID,
    stokEsSebelumnya10KG: r.StokEsSebelumnya10KG,
    pecahKemasanQty: r.PecahKemasanQty,
    esJatuhQty: r.EsJatuhQty,
    gantiReturnQty: r.GantiReturnQty,
    sealerJebolQty: r.SealerJebolQty,
  };
}

// Returns a synthesized zero-valued row (aktivitasId: null,
// stokEsSebelumnya10KG computed LIVE since no snapshot exists yet) for a
// shift that has never been saved — same pattern as Tahap 1's
// getCurrentShiftRows.
export async function getAktivitasForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<AktivitasShiftInfo> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT AktivitasID, StafOperasionalAkunID, StokEsSebelumnya10KG, PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s
    `);
  const row = result.recordset[0] as RawAktivitasRow | undefined;
  if (row) return mapAktivitasRow(row, tanggalUsaha, shift);

  const stokEs = await getTotalStokEs10KG(pool);
  return {
    aktivitasId: null,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    stafOperasionalAkunId: null,
    stokEsSebelumnya10KG: stokEs,
    pecahKemasanQty: 0,
    esJatuhQty: 0,
    gantiReturnQty: 0,
    sealerJebolQty: 0,
  };
}

export async function getAktivitasRiwayat(limit = 30): Promise<AktivitasShiftInfo[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) AktivitasID, TanggalUsaha, Shift, StafOperasionalAkunID, StokEsSebelumnya10KG,
             PecahKemasanQty, EsJatuhQty, GantiReturnQty, SealerJebolQty
      FROM DashboardAktivitasProduksiShift
      ORDER BY ShiftMulai DESC
    `);
  return (result.recordset as (RawAktivitasRow & { TanggalUsaha: Date; Shift: number })[]).map((r) =>
    mapAktivitasRow(r, r.TanggalUsaha.toISOString().slice(0, 10), r.Shift as ShiftNumber)
  );
}

export async function upsertStafOperasional(tanggalUsaha: string, shift: ShiftNumber, stafOperasionalAkunId: number | null, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("stafId", sql.Int, stafOperasionalAkunId)
    .query(`UPDATE DashboardAktivitasProduksiShift SET StafOperasionalAkunID = @stafId, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}

export async function upsertKerusakan(tanggalUsaha: string, shift: ShiftNumber, input: KerusakanInput, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("pecah", sql.Int, input.pecahKemasanQty)
    .input("jatuh", sql.Int, input.esJatuhQty)
    .input("retur", sql.Int, input.gantiReturnQty)
    .input("sealer", sql.Int, input.sealerJebolQty)
    .query(`
      UPDATE DashboardAktivitasProduksiShift
      SET PecahKemasanQty = @pecah, EsJatuhQty = @jatuh, GantiReturnQty = @retur, SealerJebolQty = @sealer, ModifiedDate = GETDATE()
      WHERE AktivitasID = @aktivitasId
    `);
}

export async function getKehadiran(tanggalUsaha: string, shift: ShiftNumber): Promise<number[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`
      SELECT kh.AnggotaID FROM DashboardAktivitasProduksiKehadiran kh
      JOIN DashboardAktivitasProduksiShift a ON a.AktivitasID = kh.AktivitasID
      WHERE a.TanggalUsaha = @t AND a.Shift = @s
    `);
  return (result.recordset as { AnggotaID: number }[]).map((r) => r.AnggotaID);
}

// Replaces the whole attendance list for this shift (delete then
// re-insert) rather than diffing — the UI always submits the complete
// checked set, never an incremental add/remove.
export async function setKehadiran(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[], akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input("aktivitasId", sql.Int, aktivitasId).query(`
      DELETE FROM DashboardAktivitasProduksiKehadiran WHERE AktivitasID = @aktivitasId
    `);
    for (const anggotaId of anggotaIds) {
      await new sql.Request(transaction)
        .input("aktivitasId", sql.Int, aktivitasId)
        .input("anggotaId", sql.Int, anggotaId)
        .query(`INSERT INTO DashboardAktivitasProduksiKehadiran (AktivitasID, AnggotaID) VALUES (@aktivitasId, @anggotaId)`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// 10KG: grouped by DashboardProduksiBatch's OWN MesinID/TanggalLabel/
// Shift columns (copied from Kualitas at insert time — see createBatch
// in produksi-warehouse.ts) — NOT via a join to DashboardProduksiKualitas,
// since KualitasID is nullable on older batches and Batch already
// carries everything needed directly.
// 5KG: summed from Qty5KGDimuat across Jadwal whose JamSelesaiMuat falls
// in this shift's window — true-UTC column, so the naive-WIB shift
// window is converted via naiveWibToUtcInstant() before the SQL
// comparison. Total only, no per-machine breakdown (no machine link
// exists on this data at all).
export async function getQtyRecapForShift(tanggalUsaha: string, shift: ShiftNumber): Promise<QtyRecap> {
  const pool = await getPool();

  const perMesinResult = await pool
    .request()
    .input("tanggalLabel", sql.Date, tanggalUsaha)
    .input("shift", sql.TinyInt, shift)
    .query(`
      SELECT b.MesinID, m.Nama AS MesinNama, SUM(b.Qty10KG) AS Qty10KG
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0 AND b.TanggalLabel = @tanggalLabel AND b.Shift = @shift
      GROUP BY b.MesinID, m.Nama
      ORDER BY m.Nama
    `);
  const perMesin = (perMesinResult.recordset as { MesinID: number; MesinNama: string; Qty10KG: number }[]).map((r) => ({
    mesinId: r.MesinID,
    mesinNama: r.MesinNama,
    qty10KG: r.Qty10KG,
  }));
  const total10KG = perMesin.reduce((sum, r) => sum + r.qty10KG, 0);

  const businessDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const window = getShiftWindow(businessDate, shift, "work");
  const startUtc = naiveWibToUtcInstant(window.start);
  const endUtc = naiveWibToUtcInstant(window.end);
  const qty5Result = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc)
    .query(`
      SELECT ISNULL(SUM(Qty5KGDimuat), 0) AS Total
      FROM DashboardPengirimanJadwal
      WHERE IsDeleted = 0 AND JamSelesaiMuat IS NOT NULL AND JamSelesaiMuat BETWEEN @start AND @end
    `);
  const total5KG = (qty5Result.recordset[0] as { Total: number }).Total;

  return { perMesin, total10KG, total5KG, totalKantongEkivalen: total10KG + total5KG / 2 };
}
