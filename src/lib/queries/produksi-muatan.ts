import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import {
  startMuat,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
} from "@/lib/queries/pengiriman-jadwal";

export interface DraftJadwalForProduksi {
  JadwalID: number;
  ArmadaNama: string;
  JamJadwal: Date;
  Qty10KGDibutuhkan: number;
  Qty5KGDibutuhkan: number;
}

// Only rows still awaiting "Mulai Muat" (JamMulaiMuat IS NULL) — once
// produksiMulaiMuat below runs, the row disappears from this list. Rows
// already muat-started but not yet "Selesai Muat" stay entirely on the
// desktop Papan Pengiriman flow, unchanged (see Task 21).
export async function getDraftJadwalForProduksi(businessDate: string): Promise<DraftJadwalForProduksi[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate)
    .query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.Status = 'Draft' AND j.JamMulaiMuat IS NULL
        AND j.JamJadwal >= DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
        AND j.JamJadwal <  DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal
      ORDER BY j.JamJadwal
    `);
  return result.recordset;
}

export interface MuatanAlokasi {
  batchId: number;
  qty10KG: number;
  qty5KG: number;
}

export interface ProduksiMulaiMuatInput {
  jadwalId: number;
  alokasi: MuatanAlokasi[];
  dicatatOlehAkunId: number;
}

export async function produksiMulaiMuat(input: ProduksiMulaiMuatInput): Promise<void> {
  if (input.alokasi.length === 0) {
    throw new AppError("Pilih minimal satu pallet untuk mengisi muatan.");
  }

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of input.alokasi) {
      if (item.qty10KG < 0 || item.qty5KG < 0) {
        throw new AppError("Jumlah yang diambil tidak boleh negatif.");
      }

      await new sql.Request(transaction)
        .input("jadwalId", sql.Int, input.jadwalId)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .input("qty5", sql.Int, item.qty5KG)
        .input("akunId", sql.Int, input.dicatatOlehAkunId)
        .query(`
          INSERT INTO DashboardProduksiMuatanDetail (JadwalID, BatchID, Qty10KGDiambil, Qty5KGDiambil, DicatatOlehAkunID)
          VALUES (@jadwalId, @batchId, @qty10, @qty5, @akunId)
        `);

      // Atomic claim: the WHERE clause encodes both "batch exists" and
      // "enough stock remains" as one condition, so the row's exclusive
      // lock (held until commit/rollback, unlike a plain SELECT's shared
      // lock) prevents two concurrent allocations from both succeeding
      // against stock that can only cover one of them. See Task 8's
      // createBatch fix for the same pattern and the race it closes.
      const claim = await new sql.Request(transaction)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .input("qty5", sql.Int, item.qty5KG)
        .query(`
          UPDATE DashboardProduksiBatch
          SET SisaQty10KG = SisaQty10KG - @qty10, SisaQty5KG = SisaQty5KG - @qty5, ModifiedDate = GETDATE()
          OUTPUT INSERTED.PosisiID, INSERTED.SisaQty10KG, INSERTED.SisaQty5KG
          WHERE BatchID = @batchId AND SisaQty10KG >= @qty10 AND SisaQty5KG >= @qty5
        `);
      if (claim.recordset.length === 0) {
        throw new AppError("Jumlah yang diambil melebihi sisa stok pallet ini.");
      }
      const { PosisiID, SisaQty10KG, SisaQty5KG } = claim.recordset[0];

      if (SisaQty10KG === 0 && SisaQty5KG === 0) {
        await new sql.Request(transaction)
          .input("posisiId", sql.Int, PosisiID)
          .query(`UPDATE DashboardProduksiPalletPosisi SET BatchIDAktif = NULL, ModifiedDate = GETDATE() WHERE PosisiID = @posisiId`);
      }
    }
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // startMuat is the existing, unmodified delivery-flow function
  // (src/lib/queries/pengiriman-jadwal.ts) — deliberately called AFTER the
  // pallet-consumption transaction above commits, not inside it, because
  // startMuat opens its own pool.request() and does not accept an external
  // sql.Transaction. Threading a transaction parameter through it would mean
  // modifying its signature, which this design explicitly avoids to protect
  // the delivery flow's own hard-won correctness (Selesai Muat/Berangkat
  // split, ArmadaConflict work) from regression. startMuat's own body is a
  // single trivial UPDATE stamping JamMulaiMuat with no business validation,
  // so the residual risk of it failing after pallet consumption has already
  // committed is accepted as negligible.
  await startMuat(input.jadwalId);
}
