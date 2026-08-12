import { getCompanyPool, type CompanyKoneksiLabel } from "@/lib/db-company";
import sql from "mssql";
import { AppError } from "@/lib/action-result";

const LABEL: CompanyKoneksiLabel = "utama";

async function getPool() {
  return getCompanyPool("pmpersada", LABEL);
}

export type TahapPembekuan = "BARU" | "MULAI" | "KRISTAL" | "SIAP" | "JADI" | "BABONAN" | "MAINTENANCE";

// Diporting persis dari formula draf referensi (getEffectiveRekStatus) —
// tahap & persentase TIDAK PERNAH disimpan sebagai kolom, selalu dihitung
// ulang dari WaktuIsi/EstimasiBeku setiap kali di-fetch.
function computeTahap(row: {
  IsMaintenance: boolean;
  BatchID: number | null;
  IsBabonan: boolean;
  WaktuIsi: Date | null;
  EstimasiBeku: Date | null;
}): { Tahap: TahapPembekuan; Pct: number; UsiaJam: number } {
  if (row.IsMaintenance) return { Tahap: "MAINTENANCE", Pct: 0, UsiaJam: 0 };
  if (row.BatchID == null || !row.WaktuIsi || !row.EstimasiBeku) return { Tahap: "BARU", Pct: 0, UsiaJam: 0 };

  const start = row.WaktuIsi.getTime();
  const usiaJam = (Date.now() - start) / 3600000;

  if (row.IsBabonan) return { Tahap: "BABONAN", Pct: 100, UsiaJam: usiaJam };

  const end = row.EstimasiBeku.getTime();
  if (end <= start) return { Tahap: "JADI", Pct: 100, UsiaJam: usiaJam };

  const pct = Math.min(100, Math.max(0, Math.round(((Date.now() - start) / (end - start)) * 100)));
  const tahap: TahapPembekuan = pct >= 100 ? "JADI" : pct >= 75 ? "SIAP" : pct >= 50 ? "KRISTAL" : pct > 0 ? "MULAI" : "BARU";
  return { Tahap: tahap, Pct: pct, UsiaJam: usiaJam };
}

export interface BakRow {
  BakID: number;
  Nama: string;
  TotalRek: number;
}

export async function getBakList(): Promise<BakRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT BakID, Nama, TotalRek FROM DashboardProduksiBak ORDER BY BakID`);
  return result.recordset;
}

export interface RekMapRow {
  RekID: number;
  BakID: number;
  BakNama: string;
  NomorRek: number;
  IsMaintenance: boolean;
  BatchID: number | null;
  JenisEs: "BK" | "BB" | null;
  JumlahCan: number | null;
  WaktuIsi: string | null;
  EstimasiBeku: string | null;
  IsBabonan: boolean;
  DicatatOlehAkunID: number | null;
  Tahap: TahapPembekuan;
  Pct: number;
  UsiaJam: number;
}

export async function getRekMap(): Promise<RekMapRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT r.RekID, r.BakID, bak.Nama AS BakNama, r.NomorRek, r.IsMaintenance, r.BatchIDAktif AS BatchID,
           b.JenisEs, b.JumlahCan, b.WaktuIsi, b.EstimasiBeku, b.IsBabonan, b.DicatatOlehAkunID
    FROM DashboardProduksiRek r
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = r.BatchIDAktif
    ORDER BY r.BakID, r.NomorRek
  `);
  const rows = result.recordset as {
    RekID: number;
    BakID: number;
    BakNama: string;
    NomorRek: number;
    IsMaintenance: boolean;
    BatchID: number | null;
    JenisEs: "BK" | "BB" | null;
    JumlahCan: number | null;
    WaktuIsi: Date | null;
    EstimasiBeku: Date | null;
    IsBabonan: boolean | null;
    DicatatOlehAkunID: number | null;
  }[];
  return rows.map((r) => {
    const eff = computeTahap({
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      IsBabonan: r.IsBabonan ?? false,
      WaktuIsi: r.WaktuIsi,
      EstimasiBeku: r.EstimasiBeku,
    });
    return {
      RekID: r.RekID,
      BakID: r.BakID,
      BakNama: r.BakNama,
      NomorRek: r.NomorRek,
      IsMaintenance: r.IsMaintenance,
      BatchID: r.BatchID,
      JenisEs: r.JenisEs,
      JumlahCan: r.JumlahCan,
      WaktuIsi: r.WaktuIsi ? r.WaktuIsi.toISOString() : null,
      EstimasiBeku: r.EstimasiBeku ? r.EstimasiBeku.toISOString() : null,
      IsBabonan: r.IsBabonan ?? false,
      DicatatOlehAkunID: r.DicatatOlehAkunID,
      Tahap: eff.Tahap,
      Pct: eff.Pct,
      UsiaJam: eff.UsiaJam,
    };
  });
}

export interface KonfigurasiRow {
  DurasiBKJam: number;
  DurasiBBJam: number;
}

export async function getKonfigurasi(): Promise<KonfigurasiRow> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}

// Dipakai dari dalam transaksi (Task 3's isiAirBaru) — Request harus dibuat
// dari sql.Transaction, bukan pool langsung, supaya baca konsisten dalam
// transaksi yang sama.
export async function getKonfigurasiInternal(transaction: sql.Transaction): Promise<KonfigurasiRow> {
  const result = await new sql.Request(transaction).query(`SELECT DurasiBKJam, DurasiBBJam FROM DashboardProduksiKonfigurasi WHERE ID = 1`);
  return result.recordset[0];
}

export async function isiAirBaru(rekId: number, jenisEs: "BK" | "BB", jumlahCan: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const config = await getKonfigurasiInternal(transaction);
    const durasiJam = jenisEs === "BK" ? config.DurasiBKJam : config.DurasiBBJam;

    const rekResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
    const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
    if (!rekRow) throw new AppError("Rek tidak ditemukan.");

    if (rekRow.BatchIDAktif) {
      await new sql.Request(transaction)
        .input("batchId", sql.Int, rekRow.BatchIDAktif)
        .query(`UPDATE DashboardProduksiBatch SET ClosedDate = GETDATE() WHERE BatchID = @batchId`);
    }

    const waktuIsi = new Date();
    const estimasiBeku = new Date(waktuIsi.getTime() + durasiJam * 3600000);

    const insertResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("jenisEs", sql.VarChar(4), jenisEs)
      .input("jumlahCan", sql.Int, jumlahCan)
      .input("waktuIsi", sql.DateTime, waktuIsi)
      .input("estimasiBeku", sql.DateTime, estimasiBeku)
      .input("akunId", sql.Int, akunId).query(`
        INSERT INTO DashboardProduksiBatch (RekID, JenisEs, JumlahCan, WaktuIsi, EstimasiBeku, DicatatOlehAkunID)
        OUTPUT INSERTED.BatchID
        VALUES (@rekId, @jenisEs, @jumlahCan, @waktuIsi, @estimasiBeku, @akunId)
      `);
    const newBatchId = (insertResult.recordset[0] as { BatchID: number }).BatchID;

    const claimResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, newBatchId)
      .input("oldBatchId", sql.Int, rekRow.BatchIDAktif)
      .query(
        `UPDATE DashboardProduksiRek SET BatchIDAktif = @batchId, IsMaintenance = 0, ModifiedDate = GETDATE() WHERE RekID = @rekId AND ISNULL(BatchIDAktif,0) = ISNULL(@oldBatchId,0)`
      );
    if (claimResult.rowsAffected[0] === 0) throw new AppError("Rek ini sedang diproses operator lain, coba lagi.");

    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, newBatchId)
      .input("akunId", sql.Int, akunId)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Isi Air Baru', @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function setBabonan(rekId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const rekResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
    const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
    if (!rekRow) throw new AppError("Rek tidak ditemukan.");
    if (!rekRow.BatchIDAktif) throw new AppError("Rek ini kosong, isi air baru dulu sebelum diset Babonan.");

    // Claim guard (sama pola dengan isiAirBaru di atas): pastikan BatchIDAktif
    // Rek belum berubah sejak SELECT di atas sebelum menulis, supaya operator
    // lain yang konkuren mengganti batch (mis. Isi Air Baru ulang) tidak
    // ke-Babonan-kan batch lama yang sudah ditutup.
    const claimResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .query(`UPDATE DashboardProduksiRek SET ModifiedDate = GETDATE() WHERE RekID = @rekId AND BatchIDAktif = @batchId`);
    if (claimResult.rowsAffected[0] === 0) throw new AppError("Rek ini sedang diproses operator lain, coba lagi.");

    await new sql.Request(transaction)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .query(`UPDATE DashboardProduksiBatch SET IsBabonan = 1 WHERE BatchID = @batchId`);
    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .input("akunId", sql.Int, akunId)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Set Babonan', @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function setMaintenance(rekId: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const rekResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
    const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
    if (!rekRow) throw new AppError("Rek tidak ditemukan.");

    if (rekRow.BatchIDAktif) {
      await new sql.Request(transaction)
        .input("batchId", sql.Int, rekRow.BatchIDAktif)
        .query(`UPDATE DashboardProduksiBatch SET ClosedDate = GETDATE() WHERE BatchID = @batchId`);
    }
    // Claim guard (sama pola dengan isiAirBaru): kondisikan pada BatchIDAktif
    // yang dibaca di atas supaya operator lain yang konkuren membuat batch
    // baru (Isi Air Baru) di Rek yang sama tidak ikut ter-NULL-kan/orphan
    // oleh UPDATE ini.
    const claimResult = await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("oldBatchId", sql.Int, rekRow.BatchIDAktif)
      .query(
        `UPDATE DashboardProduksiRek SET IsMaintenance = 1, BatchIDAktif = NULL, ModifiedDate = GETDATE() WHERE RekID = @rekId AND ISNULL(BatchIDAktif,0) = ISNULL(@oldBatchId,0)`
      );
    if (claimResult.rowsAffected[0] === 0) throw new AppError("Rek ini sedang diproses operator lain, coba lagi.");
    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .input("akunId", sql.Int, akunId)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Set Maintenance', @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

const TARGET_PCT: Record<"MULAI" | "KRISTAL" | "SIAP" | "JADI", number> = {
  MULAI: 0.25,
  KRISTAL: 0.6,
  SIAP: 0.85,
  JADI: 1.0,
};

export async function overrideTahap(rekId: number, tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI", akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool.request().input("rekId", sql.Int, rekId).query(`
    SELECT r.BatchIDAktif, b.JenisEs
    FROM DashboardProduksiRek r
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = r.BatchIDAktif
    WHERE r.RekID = @rekId
  `);
  const row = rekResult.recordset[0] as { BatchIDAktif: number | null; JenisEs: "BK" | "BB" | null } | undefined;
  if (!row || !row.BatchIDAktif || !row.JenisEs) throw new AppError("Rek ini kosong, isi air baru dulu sebelum override tahap.");

  // UPDATE Batch + INSERT AuditLog harus atomik (satu transaksi) — lihat isiAirBaru/
  // setBabonan/setMaintenance di atas untuk pola yang sama.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const config = await getKonfigurasiInternal(transaction);
    const durasiJam = row.JenisEs === "BK" ? config.DurasiBKJam : config.DurasiBBJam;
    const targetPct = TARGET_PCT[tahap];
    const waktuIsi = new Date(Date.now() - targetPct * durasiJam * 3600000);
    const estimasiBeku = new Date(waktuIsi.getTime() + durasiJam * 3600000);

    await new sql.Request(transaction)
      .input("batchId", sql.Int, row.BatchIDAktif)
      .input("waktuIsi", sql.DateTime, waktuIsi)
      .input("estimasiBeku", sql.DateTime, estimasiBeku)
      .query(`UPDATE DashboardProduksiBatch SET WaktuIsi = @waktuIsi, EstimasiBeku = @estimasiBeku WHERE BatchID = @batchId`);

    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, row.BatchIDAktif)
      .input("akunId", sql.Int, akunId)
      .input("label", sql.NVarChar(100), `Override ke ${tahap} (Admin)`)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, @label, @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function koreksiBatch(rekId: number, jenisEs: "BK" | "BB", jumlahCan: number, akunId: number): Promise<void> {
  const pool = await getPool();
  const rekResult = await pool.request().input("rekId", sql.Int, rekId).query(`SELECT BatchIDAktif FROM DashboardProduksiRek WHERE RekID = @rekId`);
  const rekRow = rekResult.recordset[0] as { BatchIDAktif: number | null } | undefined;
  if (!rekRow?.BatchIDAktif) throw new AppError("Rek ini kosong, tidak ada batch untuk dikoreksi.");

  // UPDATE Batch + INSERT AuditLog harus atomik (satu transaksi) — lihat isiAirBaru/
  // setBabonan/setMaintenance di atas untuk pola yang sama.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .input("jenisEs", sql.VarChar(4), jenisEs)
      .input("jumlahCan", sql.Int, jumlahCan)
      .query(`UPDATE DashboardProduksiBatch SET JenisEs = @jenisEs, JumlahCan = @jumlahCan WHERE BatchID = @batchId`);

    await new sql.Request(transaction)
      .input("rekId", sql.Int, rekId)
      .input("batchId", sql.Int, rekRow.BatchIDAktif)
      .input("akunId", sql.Int, akunId)
      .query(`INSERT INTO DashboardProduksiAuditLog (RekID, BatchID, AksiLabel, DicatatOlehAkunID) VALUES (@rekId, @batchId, 'Koreksi Jenis/Can (Admin)', @akunId)`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Konfigurasi tidak terikat ke Rek tertentu, sedangkan DashboardProduksiAuditLog.RekID
// bersifat NOT NULL — aksi ini secara struktural tidak bisa menulis baris AuditLog biasa.
// ModifiedDate/ModifiedByAkunID di bawah berfungsi sebagai audit trail khusus aksi ini.
export async function updateKonfigurasi(durasiBKJam: number, durasiBBJam: number, akunId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("bk", sql.Int, durasiBKJam)
    .input("bb", sql.Int, durasiBBJam)
    .input("akunId", sql.Int, akunId)
    .query(`UPDATE DashboardProduksiKonfigurasi SET DurasiBKJam = @bk, DurasiBBJam = @bb, ModifiedDate = GETDATE(), ModifiedByAkunID = @akunId WHERE ID = 1`);
}

export interface BatchRow {
  BatchID: number;
  RekID: number;
  BakNama: string;
  NomorRek: number;
  JenisEs: "BK" | "BB";
  JumlahCan: number;
  IsBabonan: boolean;
  WaktuIsi: string;
  EstimasiBeku: string;
  ClosedDate: string | null;
  DicatatOlehAkunID: number;
}

export async function getRiwayatBatch(): Promise<BatchRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1000 b.BatchID, b.RekID, bak.Nama AS BakNama, r.NomorRek, b.JenisEs, b.JumlahCan, b.IsBabonan,
           b.WaktuIsi, b.EstimasiBeku, b.ClosedDate, b.DicatatOlehAkunID
    FROM DashboardProduksiBatch b
    JOIN DashboardProduksiRek r ON r.RekID = b.RekID
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    ORDER BY b.CreatedDate DESC
  `);
  const rows = result.recordset as (Omit<BatchRow, "WaktuIsi" | "EstimasiBeku" | "ClosedDate"> & {
    WaktuIsi: Date;
    EstimasiBeku: Date;
    ClosedDate: Date | null;
  })[];
  return rows.map((r) => ({
    ...r,
    WaktuIsi: r.WaktuIsi.toISOString(),
    EstimasiBeku: r.EstimasiBeku.toISOString(),
    ClosedDate: r.ClosedDate ? r.ClosedDate.toISOString() : null,
  }));
}

export interface AuditLogRow {
  LogID: number;
  RekID: number;
  BakNama: string;
  NomorRek: number;
  AksiLabel: string;
  Keterangan: string | null;
  DicatatOlehAkunID: number;
  CreatedDate: string;
}

export async function getAuditLog(akunId?: number): Promise<AuditLogRow[]> {
  const pool = await getPool();
  const request = pool.request();
  let whereClause = "";
  if (akunId != null) {
    request.input("akunId", sql.Int, akunId);
    whereClause = "WHERE l.DicatatOlehAkunID = @akunId";
  }
  const result = await request.query(`
    SELECT TOP 500 l.LogID, l.RekID, bak.Nama AS BakNama, r.NomorRek, l.AksiLabel, l.Keterangan, l.DicatatOlehAkunID, l.CreatedDate
    FROM DashboardProduksiAuditLog l
    JOIN DashboardProduksiRek r ON r.RekID = l.RekID
    JOIN DashboardProduksiBak bak ON bak.BakID = r.BakID
    ${whereClause}
    ORDER BY l.CreatedDate DESC
  `);
  const rows = result.recordset as (Omit<AuditLogRow, "CreatedDate"> & { CreatedDate: Date })[];
  return rows.map((r) => ({ ...r, CreatedDate: r.CreatedDate.toISOString() }));
}
