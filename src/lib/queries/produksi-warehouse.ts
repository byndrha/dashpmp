import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface PalletPosisiRow {
  PosisiID: number;
  Kode: string;
  BatchIDAktif: number | null;
  MesinNama: string | null;
  TanggalProduksi: Date | null;
  SisaQty10KG: number | null;
  SisaQty5KG: number | null;
  TanggalLabel: Date | null;
  Shift: 1 | 2 | 3 | null;
}

export async function getWarehouseMap(): Promise<PalletPosisiRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT p.PosisiID, p.Kode, p.BatchIDAktif, m.Nama AS MesinNama, b.TanggalProduksi, b.SisaQty10KG, b.SisaQty5KG,
           b.TanggalLabel, b.Shift
    FROM DashboardProduksiPalletPosisi p
    LEFT JOIN DashboardProduksiBatch b ON b.BatchID = p.BatchIDAktif AND b.IsDeleted = 0
    LEFT JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
    ORDER BY p.Kode
  `);
  return result.recordset;
}

export interface RiwayatProduksiRow {
  BatchID: number;
  Kode: string;
  MesinNama: string;
  TanggalProduksi: Date;
  Qty10KG: number;
  Qty5KG: number;
  SisaQty10KG: number;
  SisaQty5KG: number;
  DicatatOlehAkunID: number;
  TanggalLabel: Date;
  Shift: 1 | 2 | 3;
}

export async function getRiwayatProduksi(limit = 50): Promise<RiwayatProduksiRow[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("limit", sql.Int, limit)
    .query(`
      SELECT TOP (@limit) b.BatchID, p.Kode, m.Nama AS MesinNama, b.TanggalProduksi,
             b.Qty10KG, b.Qty5KG, b.SisaQty10KG, b.SisaQty5KG, b.DicatatOlehAkunID,
             b.TanggalLabel, b.Shift
      FROM DashboardProduksiBatch b
      JOIN DashboardProduksiPalletPosisi p ON p.PosisiID = b.PosisiID
      JOIN DashboardProduksiMesin m ON m.MesinID = b.MesinID
      WHERE b.IsDeleted = 0
      ORDER BY b.TanggalProduksi DESC
    `);
  return result.recordset;
}

export interface CreateBatchInput {
  mesinId: number;
  posisiId: number;
  qty10KG: number;
  qty5KG: number;
  tanggalLabel: string;
  shift: 1 | 2 | 3;
  dicatatOlehAkunId: number;
}

// A pallet position holds exactly one batch until it's fully consumed
// (BatchIDAktif is cleared only when both Sisa columns hit 0 — see
// produksi-muatan.ts's produksiMulaiMuat) — this function enforces that
// "one pallet = one batch at a time" rule at creation time.
export async function createBatch(input: CreateBatchInput): Promise<number> {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    // Insert speculatively — this is safe because it's inside the same
    // transaction as the atomic claim below: if the claim fails, the
    // rollback discards this row too, so no orphan batch is ever visible
    // outside this function.
    const insertResult = await new sql.Request(transaction)
      .input("mesinId", sql.Int, input.mesinId)
      .input("posisiId", sql.Int, input.posisiId)
      .input("qty10", sql.Int, input.qty10KG)
      .input("qty5", sql.Int, input.qty5KG)
      .input("akunId", sql.Int, input.dicatatOlehAkunId)
      .input("tanggalLabel", sql.Date, input.tanggalLabel)
      .input("shift", sql.TinyInt, input.shift)
      .query(`
        INSERT INTO DashboardProduksiBatch (MesinID, PosisiID, TanggalProduksi, Qty10KG, Qty5KG, SisaQty10KG, SisaQty5KG, DicatatOlehAkunID, TanggalLabel, Shift)
        OUTPUT INSERTED.BatchID
        VALUES (@mesinId, @posisiId, GETDATE(), @qty10, @qty5, @qty10, @qty5, @akunId, @tanggalLabel, @shift)
      `);
    const batchId = insertResult.recordset[0].BatchID as number;

    // Atomic claim: the WHERE clause encodes both preconditions (position
    // exists, position is currently empty) as part of the write itself,
    // instead of a separate SELECT-then-act that a racing call could slip
    // between. rowsAffected[0] === 0 means either the position doesn't
    // exist or another transaction already claimed it first — same
    // idiom as selesaiMuat's claim UPDATE in pengiriman-jadwal.ts.
    const claim = await new sql.Request(transaction)
      .input("posisiId", sql.Int, input.posisiId)
      .input("batchId", sql.Int, batchId)
      .query(
        `UPDATE DashboardProduksiPalletPosisi SET BatchIDAktif = @batchId, ModifiedDate = GETDATE() WHERE PosisiID = @posisiId AND BatchIDAktif IS NULL`
      );
    if (claim.rowsAffected[0] === 0) {
      throw new AppError("Posisi pallet ini sudah terisi batch lain.");
    }

    await transaction.commit();
    return batchId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
