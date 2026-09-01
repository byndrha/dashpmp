import { getPool, sql } from "@/lib/db";
import { getReportShift, getShiftWindow, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import { naiveWibToUtcInstant } from "@/lib/business-date";
import { getAnggotaTim } from "@/lib/queries/tim-produksi";
import { getJadwalUntukShift } from "@/lib/queries/jadwal-tim-produksi";
export { hitungTotalDenda, hitungKontribusiPerOrang } from "@/lib/aktivitas-produksi-shared";

export interface AktivitasShiftInfo {
  aktivitasId: number | null; // null when this shift has never been saved yet
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  timId: number | null;
  stafOperasionalAkunId: number | null;
  stokEsSebelumnya10KG: number;
  pecahKemasanQty: number;
  esJatuhQty: number;
  gantiReturnQty: number;
  sealerJebolQty: number;
  // Kepala/Wakil Kepala Produksi Tim yang bertugas shift ini (dari
  // DashboardTimProduksi.KepalaAkunID/WakilKepalaAkunID via TimID di
  // atas) -- assignment standing, bukan per-shift. null kalau Tim belum
  // punya Kepala/Wakil ditetapkan.
  kepalaAkunId: number | null;
  wakilKepalaAkunId: number | null;
  // Status hadir KHUSUS shift ini (DashboardAktivitasProduksiShift.KepalaHadir/
  // WakilHadir) -- tidak mengubah assignment standing di atas. true untuk
  // shift yang belum pernah disimpan (belum ada baris untuk ditandai
  // tidak hadir sama sekali).
  kepalaHadir: boolean;
  wakilHadir: boolean;
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

async function getTimKepalaWakil(pool: sql.ConnectionPool, timId: number | null): Promise<{ kepalaAkunId: number | null; wakilKepalaAkunId: number | null }> {
  if (timId == null) return { kepalaAkunId: null, wakilKepalaAkunId: null };
  const result = await pool
    .request()
    .input("timId", sql.Int, timId)
    .query(`SELECT KepalaAkunID, WakilKepalaAkunID FROM DashboardTimProduksi WHERE TimID = @timId AND IsDeleted = 0`);
  const row = result.recordset[0] as { KepalaAkunID: number | null; WakilKepalaAkunID: number | null } | undefined;
  return row ? { kepalaAkunId: row.KepalaAkunID, wakilKepalaAkunId: row.WakilKepalaAkunID } : { kepalaAkunId: null, wakilKepalaAkunId: null };
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
  const timId = await getJadwalUntukShift(tanggalUsaha, shift);
  const result = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .input("shiftMulai", sql.DateTime, shiftMulai)
    .input("stokEs", sql.Int, stokEs)
    .input("timId", sql.Int, timId)
    .input("akunId", sql.Int, akunId)
    .query(`
      INSERT INTO DashboardAktivitasProduksiShift (TanggalUsaha, Shift, ShiftMulai, StokEsSebelumnya10KG, TimID, CreatedByAkunID, StafOperasionalAkunID)
      OUTPUT INSERTED.AktivitasID
      VALUES (@t, @s, @shiftMulai, @stokEs, @timId, @akunId, @akunId)
    `);
  return (result.recordset[0] as { AktivitasID: number }).AktivitasID;
}

interface RawAktivitasRow {
  AktivitasID: number;
  TimID: number | null;
  StafOperasionalAkunID: number | null;
  StokEsSebelumnya10KG: number;
  PecahKemasanQty: number;
  EsJatuhQty: number;
  GantiReturnQty: number;
  SealerJebolQty: number;
  KepalaAkunID: number | null;
  WakilKepalaAkunID: number | null;
  KepalaHadir: boolean;
  WakilHadir: boolean;
}

function mapAktivitasRow(r: RawAktivitasRow, tanggalUsaha: string, shift: ShiftNumber): AktivitasShiftInfo {
  return {
    aktivitasId: r.AktivitasID,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId: r.TimID,
    stafOperasionalAkunId: r.StafOperasionalAkunID,
    stokEsSebelumnya10KG: r.StokEsSebelumnya10KG,
    pecahKemasanQty: r.PecahKemasanQty,
    esJatuhQty: r.EsJatuhQty,
    gantiReturnQty: r.GantiReturnQty,
    sealerJebolQty: r.SealerJebolQty,
    kepalaAkunId: r.KepalaAkunID,
    wakilKepalaAkunId: r.WakilKepalaAkunID,
    kepalaHadir: r.KepalaHadir,
    wakilHadir: r.WakilHadir,
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
      SELECT s.AktivitasID, s.TimID, s.StafOperasionalAkunID, s.StokEsSebelumnya10KG, s.PecahKemasanQty, s.EsJatuhQty,
             s.GantiReturnQty, s.SealerJebolQty, s.KepalaHadir, s.WakilHadir, t.KepalaAkunID, t.WakilKepalaAkunID
      FROM DashboardAktivitasProduksiShift s
      LEFT JOIN DashboardTimProduksi t ON t.TimID = s.TimID
      WHERE s.TanggalUsaha = @t AND s.Shift = @s
    `);
  const row = result.recordset[0] as RawAktivitasRow | undefined;
  if (row) return mapAktivitasRow(row, tanggalUsaha, shift);

  const stokEs = await getTotalStokEs10KG(pool);
  const timId = await getJadwalUntukShift(tanggalUsaha, shift);
  const { kepalaAkunId, wakilKepalaAkunId } = await getTimKepalaWakil(pool, timId);
  return {
    aktivitasId: null,
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId,
    stafOperasionalAkunId: null,
    stokEsSebelumnya10KG: stokEs,
    pecahKemasanQty: 0,
    esJatuhQty: 0,
    gantiReturnQty: 0,
    sealerJebolQty: 0,
    kepalaAkunId,
    wakilKepalaAkunId,
    kepalaHadir: true,
    wakilHadir: true,
  };
}

export async function getAktivitasRiwayat(limit = 30): Promise<AktivitasShiftInfo[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) s.AktivitasID, s.TanggalUsaha, s.Shift, s.TimID, s.StafOperasionalAkunID, s.StokEsSebelumnya10KG,
             s.PecahKemasanQty, s.EsJatuhQty, s.GantiReturnQty, s.SealerJebolQty, s.KepalaHadir, s.WakilHadir,
             t.KepalaAkunID, t.WakilKepalaAkunID
      FROM DashboardAktivitasProduksiShift s
      LEFT JOIN DashboardTimProduksi t ON t.TimID = s.TimID
      ORDER BY s.ShiftMulai DESC
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

// Menandai Kepala Produksi hadir/tidak hadir KHUSUS shift ini -- tidak
// mengubah DashboardTimProduksi.KepalaAkunID (assignment standing Tim
// tetap sama). Dipanggil dari roster Aktivitas Produksi (produksi-app).
export async function setKepalaHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("hadir", sql.Bit, hadir)
    .query(`UPDATE DashboardAktivitasProduksiShift SET KepalaHadir = @hadir, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}

export async function setWakilHadir(tanggalUsaha: string, shift: ShiftNumber, hadir: boolean, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId)
    .input("hadir", sql.Bit, hadir)
    .query(`UPDATE DashboardAktivitasProduksiShift SET WakilHadir = @hadir, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);
}

export interface SusunanTimRow {
  anggotaId: number;
  nama: string;
  urutan: number;
}

// Who's actually on duty for this ONE (tanggalUsaha, shift) occurrence --
// independent of DashboardTimProduksiAnggota's permanent team membership
// (see getAnggotaTim in tim-produksi.ts). Distinguishes "never saved" (no
// DashboardAktivitasProduksiShift row at all -- falls back to this shift's
// own permanent team as a starting point, NOT written to DB yet) from
// "saved with nobody in it" (a real, empty, already-persisted roster) by
// checking for the Shift row's existence first, not by whether the
// Kehadiran query comes back empty.
export async function getSusunanTim(tanggalUsaha: string, shift: ShiftNumber): Promise<SusunanTimRow[]> {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("t", sql.Date, tanggalUsaha)
    .input("s", sql.TinyInt, shift)
    .query(`SELECT AktivitasID FROM DashboardAktivitasProduksiShift WHERE TanggalUsaha = @t AND Shift = @s`);
  const aktivitasId = (existing.recordset[0] as { AktivitasID: number } | undefined)?.AktivitasID;

  if (aktivitasId == null) {
    const timId = await getJadwalUntukShift(tanggalUsaha, shift);
    if (timId == null) return [];
    const timTetap = await getAnggotaTim(timId);
    return timTetap.map((a, i) => ({ anggotaId: a.anggotaId, nama: a.nama, urutan: i }));
  }

  const result = await pool
    .request()
    .input("aktivitasId", sql.Int, aktivitasId).query(`
      SELECT kh.AnggotaID, kh.Urutan, a.Nama
      FROM DashboardAktivitasProduksiKehadiran kh
      JOIN DashboardTimProduksiAnggota a ON a.AnggotaID = kh.AnggotaID
      WHERE kh.AktivitasID = @aktivitasId
      ORDER BY kh.Urutan ASC
    `);
  return (result.recordset as { AnggotaID: number; Urutan: number; Nama: string }[]).map((r) => ({
    anggotaId: r.AnggotaID,
    urutan: r.Urutan,
    nama: r.Nama,
  }));
}

// Replaces the whole susunan tim for this shift (delete then re-insert)
// rather than diffing -- the UI always submits the complete ordered list,
// never an incremental add/remove/reorder. Urutan = the array's own index,
// so callers encode order purely by array position.
export async function setSusunanTim(tanggalUsaha: string, shift: ShiftNumber, anggotaIds: number[], akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction).input("aktivitasId", sql.Int, aktivitasId).query(`
      DELETE FROM DashboardAktivitasProduksiKehadiran WHERE AktivitasID = @aktivitasId
    `);
    for (let i = 0; i < anggotaIds.length; i++) {
      await new sql.Request(transaction)
        .input("aktivitasId", sql.Int, aktivitasId)
        .input("anggotaId", sql.Int, anggotaIds[i])
        .input("urutan", sql.Int, i)
        .query(`INSERT INTO DashboardAktivitasProduksiKehadiran (AktivitasID, AnggotaID, Urutan) VALUES (@aktivitasId, @anggotaId, @urutan)`);
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Koreksi live "Tim Bertugas" -- hanya memengaruhi kejadian shift ini
// (DashboardJadwalTimProduksi TIDAK ikut berubah, lihat spec Bagian 3.2).
// Kalau nilainya benar-benar berubah, Susunan Tim ditulis ulang ke roster
// default Tim yang baru (spec Bagian 3.3) -- memilih Tim yang sama tidak
// menghapus penyesuaian manual yang sudah dilakukan.
export async function setTimBertugas(tanggalUsaha: string, shift: ShiftNumber, timId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const aktivitasId = await ensureAktivitasRow(pool, tanggalUsaha, shift, akunId);

  let timIdSaatIni: number | null;
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const current = await new sql.Request(transaction)
      .input("aktivitasId", sql.Int, aktivitasId)
      .query(`SELECT TimID FROM DashboardAktivitasProduksiShift WITH (UPDLOCK, HOLDLOCK) WHERE AktivitasID = @aktivitasId`);
    timIdSaatIni = (current.recordset[0] as { TimID: number | null }).TimID;

    await new sql.Request(transaction)
      .input("aktivitasId", sql.Int, aktivitasId)
      .input("timId", sql.Int, timId)
      .query(`UPDATE DashboardAktivitasProduksiShift SET TimID = @timId, ModifiedDate = GETDATE() WHERE AktivitasID = @aktivitasId`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  if (timIdSaatIni !== timId) {
    const anggotaBaru = await getAnggotaTim(timId);
    await setSusunanTim(tanggalUsaha, shift, anggotaBaru.map((a) => a.anggotaId), akunId);
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
// TakeAway 10KG/5KG: same JamSelesaiMuat-in-shift-window pattern, from
// DashboardTakeAwayMuatan (its own manual, non-FIFO qty, see
// takeaway-muatan.ts) — folded into total10KG/total5KG below rather than
// broken out separately.
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
  const total10KGBatch = perMesin.reduce((sum, r) => sum + r.qty10KG, 0);

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
  const total5KGJadwal = (qty5Result.recordset[0] as { Total: number }).Total;

  // TakeAway 10kg/5kg — dicatat manual tanpa FIFO (sama seperti Qty5KGDimuat
  // di atas), diselesaikan lewat Selesai Muat produksi-app milik TakeAway
  // sendiri (JamSelesaiMuat true-UTC, window shift yang sama dipakai ulang).
  // Digabung ke total yang sudah ada, bukan kategori laporan terpisah — lihat
  // docs/superpowers/specs/2026-08-31-takeaway-alur-muat-produksi-design.md.
  const takeAwayResult = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc)
    .query(`
      SELECT Variant, ISNULL(SUM(QtyDimuat), 0) AS Total
      FROM DashboardTakeAwayMuatan
      WHERE IsDeleted = 0 AND JamSelesaiMuat IS NOT NULL AND JamSelesaiMuat BETWEEN @start AND @end
      GROUP BY Variant
    `);
  const takeAwayRows = takeAwayResult.recordset as { Variant: string; Total: number }[];
  const takeAway10KG = takeAwayRows.find((r) => r.Variant === "10kg")?.Total ?? 0;
  const takeAway5KG = takeAwayRows.find((r) => r.Variant === "5kg")?.Total ?? 0;

  const total10KG = total10KGBatch + takeAway10KG;
  const total5KG = total5KGJadwal + takeAway5KG;

  return { perMesin, total10KG, total5KG, totalKantongEkivalen: total10KG + total5KG / 2 };
}
