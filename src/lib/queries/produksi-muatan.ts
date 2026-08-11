import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import {
  startMuat,
  selesaiMuat,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
} from "@/lib/queries/pengiriman-jadwal";

export interface DraftJadwalForProduksi {
  JadwalID: number;
  ArmadaNama: string;
  JamJadwal: Date;
  // Set once produksiStartMuat (below) has run for this card — the UI uses
  // this to skip straight to the alokasi screen (instead of showing "Mulai
  // Muat" again) when the operator re-opens a card they already started,
  // e.g. after backing out mid-flow or reloading the app.
  JamMulaiMuat: Date | null;
  Qty10KGDibutuhkan: number;
  Qty5KGDibutuhkan: number;
}

// Every Jadwal still in Draft — both not-yet-started (JamMulaiMuat NULL)
// and started-but-not-finished (JamMulaiMuat set, still Draft because
// produksiSelesaiMuat/selesaiMuat hasn't run yet). A row only leaves this
// list once selesaiMuat flips Status to 'Terbit'. Keeping started-but-
// unfinished rows here (rather than filtering them out once JamMulaiMuat is
// set) matters because the 2-step "Mulai Muat" -> alokasi flow is otherwise
// unreachable again if the operator backs out or reloads mid-flow.
//
// Deliberately NOT restricted to a single business date: a Draft Jadwal
// that ages out of "today" without being filled must still be reachable
// here, since the desktop "Mulai Muat" button is only a fallback now (see
// route-validation-dialog.tsx) — produksi-app is the primary path. Ordered
// newest-scheduled-first (most recently added keberangkatan on top) per
// user request — older backlog Drafts stay in the list, just lower down.
export async function getDraftJadwalForProduksi(): Promise<DraftJadwalForProduksi[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamMulaiMuat,
           ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
           ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
    FROM DashboardPengirimanJadwal j
    LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
    LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
    WHERE j.IsDeleted = 0 AND j.Status = 'Draft'
    GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamMulaiMuat
    ORDER BY j.JamJadwal DESC
  `);
  return result.recordset;
}

// Explicit "Mulai Muat" step — stamps JamMulaiMuat with no pallet allocation
// yet (that happens next, in produksiSelesaiMuat below). Thin re-export of
// the existing delivery-flow startMuat so produksi-app's action layer only
// ever imports from this produksi-domain module, matching every other
// produksi-muatan export.
export async function produksiStartMuat(jadwalId: number): Promise<void> {
  await startMuat(jadwalId);
}

export interface MuatanAlokasi {
  batchId: number;
  qty10KG: number;
  qty5KG: number;
}

export interface ProduksiSelesaiMuatInput {
  jadwalId: number;
  alokasi: MuatanAlokasi[];
  dicatatOlehAkunId: number;
}

// Allocates pallet stock to the Jadwal, then completes the real "Selesai
// Muat" transition (driver/route/capacity-validated, creates real
// DeliveryOrder + SalesInvoice documents) — the produksi-app equivalent of
// desktop's "Selesai Muat" button. Requires produksiStartMuat to already
// have been called for this jadwalId (enforced by the UI flow: the alokasi
// screen only ever opens after "Mulai Muat" succeeds), not re-checked here
// since selesaiMuat below doesn't need JamMulaiMuat itself.
export async function produksiSelesaiMuat(
  input: ProduksiSelesaiMuatInput
): Promise<{ jadwalDetailId: number; invoiceToken: string }[]> {
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

  // selesaiMuat is the existing, unmodified delivery-flow function
  // (src/lib/queries/pengiriman-jadwal.ts) — deliberately called AFTER the
  // pallet-consumption transaction above commits, not inside it, because
  // selesaiMuat opens its own pool.request()/sql.Transaction and does not
  // accept an external one. Threading a transaction parameter through it
  // would mean modifying its signature, which this design explicitly avoids
  // to protect the delivery flow's own hard-won correctness (Selesai
  // Muat/Berangkat split, ArmadaConflict work, external-DO handling) from
  // regression. Unlike the old startMuat call this replaces, selesaiMuat is
  // NOT trivial — it validates driver/route/capacity and creates real
  // DeliveryOrder + SalesInvoice documents, so it can genuinely reject
  // (AppError) after pallet stock has already been committed. That's the
  // same accepted trade-off already documented above (residual risk of a
  // second step failing after the first commits), just with a heavier
  // second step; the caller (produksiSelesaiMuatAction) surfaces the
  // AppError directly so the operator sees exactly why (e.g. "Driver wajib
  // diisi" / "Rute belum berhasil divalidasi") and can go fix it on desktop
  // — the pallet allocation itself is not rolled back, matching how a
  // desktop-side Selesai Muat failure after Mulai Muat already behaves
  // today (JamMulaiMuat stays set, operator retries Selesai Muat).
  return selesaiMuat(input.jadwalId);
}
